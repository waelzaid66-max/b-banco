import { openai, defaultChatModel } from "@workspace/integrations-openai-ai-server";
import { getMyMetrics, listMySavedSearches } from "./ProfileService";
import { getOrCreateUser } from "./UserService";
import { getDealerListings } from "./ListingService";
import { listConversations } from "./ConversationService";
import { parseSearchQuery, searchListings, type ParsedSearchQuery } from "./SearchService";

/**
 * BANCO Assistant — server-side, grounded, context-aware AI helper.
 *
 * Design rules (Task #38 / #103):
 *  - The MODEL CONFIG, PROMPT and TOOLS live on the server. The client only
 *    sends the user's turns; it can never change the system instructions, the
 *    grounding, or the tools.
 *  - Context is REAL and best-effort: we inject the signed-in user's profile,
 *    their own listings, the names of their saved searches, and a digest of
 *    their recent conversations. Nothing is fabricated — if a piece of context
 *    fails to load we simply tell the model it's unavailable.
 *  - The model can call TOOLS to (a) search the live marketplace, (b) point the
 *    user to an app screen, or (c) open one of their real conversations. Every
 *    resulting "action" the client receives is built from REAL data on the
 *    server (real listing ids, the user's real conversation ids, real search
 *    filters) — the model can never invent a listing, a price or a route.
 *  - Hard guardrails forbid inventing counts, prices, availability, financing,
 *    ratings or any number; the model must use the search tool to find real
 *    listings rather than guess.
 */

export type AssistantTurn = { role: "user" | "assistant"; content: string };

export type AssistantActionKind = "listing" | "search" | "conversation" | "navigate";

export type AssistantScreen =
  | "home"
  | "search"
  | "saved"
  | "messages"
  | "my_listings"
  | "create_listing"
  | "wallet"
  | "billing"
  | "profile"
  | "notifications"
  | "rentals"
  | "supply_hub"
  | "industry";

export interface AssistantAction {
  kind: AssistantActionKind;
  label: string;
  listing_id?: string | null;
  price_display?: string | null;
  thumbnail_url?: string | null;
  location?: string | null;
  query?: string | null;
  category?: string | null;
  max_price?: number | null;
  has_installment?: boolean | null;
  conversation_id?: string | null;
  screen?: AssistantScreen | null;
}

const MAX_HISTORY = 8;
const MAX_CONTENT = 2000;
const MAX_TOOL_ROUNDS = 4;
const MAX_LISTING_ACTIONS = 4;

/** Cap completion size (cost control). Override with OPENAI_MAX_COMPLETION_TOKENS. */
function maxCompletionTokens(): number {
  const raw = Number(process.env.OPENAI_MAX_COMPLETION_TOKENS);
  if (Number.isFinite(raw) && raw >= 256 && raw <= 8192) return Math.floor(raw);
  return 2048;
}

type Metrics = Awaited<ReturnType<typeof getMyMetrics>>;
type DealerListing = Awaited<ReturnType<typeof getDealerListings>>["items"][number];
type Conversation = Awaited<ReturnType<typeof listConversations>>[number];

// The OpenAI SDK is only resolvable transitively via the integration package;
// derive its param types from the exported client instead of importing it.
type CreateBody = NonNullable<Parameters<typeof openai.chat.completions.create>[0]>;
type ChatMessages = CreateBody["messages"];
type ChatMessage = ChatMessages[number];
type ChatTools = NonNullable<CreateBody["tools"]>;

interface AssistantContext {
  name?: string | null;
  role?: string | null;
  metrics?: Metrics | null;
  savedSearches?: string[];
  listings?: DealerListing[];
  conversations?: Conversation[];
}

const SCREENS: readonly AssistantScreen[] = [
  "home",
  "search",
  "saved",
  "messages",
  "my_listings",
  "create_listing",
  "wallet",
  "billing",
  "profile",
  "notifications",
  "rentals",
  "supply_hub",
  "industry",
];

const SCREEN_LABELS: Record<AssistantScreen, { en: string; ar: string }> = {
  home: { en: "Home", ar: "الرئيسية" },
  search: { en: "Search", ar: "بحث" },
  saved: { en: "Saved", ar: "المحفوظات" },
  messages: { en: "Messages", ar: "الرسائل" },
  my_listings: { en: "My listings", ar: "إعلاناتي" },
  create_listing: { en: "Post a listing", ar: "أضف إعلان" },
  wallet: { en: "Wallet", ar: "المحفظة" },
  billing: { en: "Billing", ar: "الفواتير والاشتراك" },
  profile: { en: "Profile", ar: "حسابي" },
  notifications: { en: "Notifications", ar: "الإشعارات" },
  rentals: { en: "Rentals hub", ar: "مركز الإيجار" },
  supply_hub: { en: "Business & supply", ar: "الأعمال والتوريد" },
  industry: { en: "Industry hub", ar: "مركز الصناعة" },
};

function isArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

const TOOLS: ChatTools = [
  {
    type: "function",
    function: {
      name: "search_marketplace",
      description:
        "Search BANCO's live marketplace for REAL, currently-active listings. Call this whenever the user wants to find, buy, browse or compare assets (cars, real estate, industrial machines/factories/land). Returns only real listings; never describe a listing you did not get from this tool.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Free-text search, e.g. 'Toyota Corolla', 'apartment in New Cairo', 'production line'. Arabic is supported.",
          },
          category: {
            type: "string",
            enum: ["car", "real_estate", "industrial"],
            description: "Optional category filter.",
          },
          max_price: {
            type: "number",
            description: "Optional maximum price in EGP.",
          },
          has_installment: {
            type: "boolean",
            description: "Set true to only return listings that offer installment/financing.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_app_screen",
      description:
        "Offer the user a shortcut to a screen in the BANCO app. Use it to guide them to a feature you mention (e.g. how to post a listing -> create_listing).",
      parameters: {
        type: "object",
        properties: {
          screen: {
            type: "string",
            enum: SCREENS as unknown as string[],
          },
        },
        required: ["screen"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_conversation",
      description:
        "Offer the user a shortcut to open one of their EXISTING message threads. Only use a conversation_id listed in the provided conversation context.",
      parameters: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
        },
        required: ["conversation_id"],
      },
    },
  },
];

function buildSystemPrompt(ctx: AssistantContext): string {
  const lines: string[] = [];
  lines.push(
    "You are BANCO Assistant, the in-app helper for BANCO — an asset marketplace for Egypt and the GCC " +
      "(cars, real estate, industrial machines, equipment, factories and land).",
  );
  lines.push(
    "Your job: help the user search and compare listings, answer their questions, guide them through the " +
      "app's features, and suggest relevant real listings. You can also help sellers draft clear, honest " +
      "listing descriptions.",
  );
  lines.push("");
  lines.push("TOOLS — use them, don't guess:");
  lines.push(
    "- search_marketplace: call it whenever the user wants to find/buy/browse/compare assets. NEVER state a " +
      "listing's title, price or availability unless it came from a tool result.",
  );
  lines.push(
    "- open_app_screen: when you guide the user to a feature, attach the matching screen so they can tap straight there.",
  );
  lines.push(
    "- open_conversation: when the user asks about a specific chat in the context below, attach it so they can open it.",
  );
  lines.push("");
  lines.push("STRICT RULES — follow them exactly:");
  lines.push(
    "- Use ONLY real BANCO context and real tool results. NEVER invent or estimate listing counts, prices, " +
      "availability, financing terms, ratings, reviews, likes or any number.",
  );
  lines.push(
    "- If you don't have a piece of data and no tool can get it, say so plainly and tell the user where in " +
      "the app to find it. Do not guess.",
  );
  lines.push(
    "- Do not perform financial calculations or give financial, legal or investment advice. For any price or " +
      "total, point the user to the figure shown on the listing itself.",
  );
  lines.push(
    "- Reply in the SAME language as the user's latest message: natural Egyptian Arabic if they wrote in " +
      "Arabic, otherwise English. Be concise, friendly and practical.",
  );
  lines.push("");
  lines.push("REAL CONTEXT ABOUT THIS USER (use it naturally; do not dump raw field names):");
  lines.push(`- Account type: ${ctx.role || "individual"}.`);
  if (ctx.name) lines.push(`- Name: ${ctx.name}.`);
  if (ctx.metrics) {
    lines.push(
      `- Their listings: ${ctx.metrics.total_listings} total, ${ctx.metrics.active_listings} currently active.`,
    );
    lines.push(
      `- Member since ${ctx.metrics.member_since} (${ctx.metrics.years_active} year(s) active).`,
    );
  } else {
    lines.push("- Listing metrics: not available right now.");
  }

  if (ctx.listings && ctx.listings.length > 0) {
    lines.push("- Their own listings (most recent first):");
    for (const l of ctx.listings) {
      lines.push(
        `  • [${l.id}] "${l.title}" — ${l.price_display}, ${l.status}, ${l.location}` +
          ` (views ${l.views}, leads ${l.leads}).`,
      );
    }
  } else {
    lines.push("- They have no listings of their own yet.");
  }

  if (ctx.savedSearches && ctx.savedSearches.length > 0) {
    lines.push(`- Saved searches they track: ${ctx.savedSearches.join("; ")}.`);
  } else {
    lines.push("- Saved searches: none yet.");
  }

  if (ctx.conversations && ctx.conversations.length > 0) {
    lines.push("- Their recent conversations (newest first):");
    for (const c of ctx.conversations) {
      const last = c.last_message_text ? `"${truncate(c.last_message_text, 80)}"` : "no messages yet";
      const unread = c.unread > 0 ? `, ${c.unread} unread` : "";
      lines.push(
        `  • [${c.id}] with ${c.counterparty_name} about "${c.listing_title ?? "a listing"}"` +
          ` (you are the ${c.viewer_role}${unread}) — last: ${last}.`,
      );
    }
  } else {
    lines.push("- They have no conversations yet.");
  }

  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Run a real marketplace search; returns items plus the effective filters used. */
async function runMarketplaceSearch(args: {
  query?: unknown;
  category?: unknown;
  max_price?: unknown;
  has_installment?: unknown;
}) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const parsed: ParsedSearchQuery = query ? parseSearchQuery(query) : {};

  if (
    args.category === "car" ||
    args.category === "real_estate" ||
    args.category === "industrial"
  ) {
    parsed.category = args.category;
  }
  if (typeof args.max_price === "number" && Number.isFinite(args.max_price) && args.max_price > 0) {
    parsed.max_price = args.max_price;
  }
  if (args.has_installment === true) {
    parsed.has_installment = true;
  }

  const { items } = await searchListings(parsed, undefined, 6);
  return { items, query, parsed };
}

function searchActionFor(query: string, parsed: ParsedSearchQuery, ar: boolean): AssistantAction {
  return {
    kind: "search",
    label: ar ? "عرض كل النتائج" : "See all results",
    query: query || null,
    category: parsed.category ?? null,
    max_price: parsed.max_price ?? null,
    has_installment: parsed.has_installment ?? null,
  };
}

export async function askBancoAssistant(
  clerkId: string,
  input: { message: string; history?: AssistantTurn[] },
): Promise<{ answer: string; actions: AssistantAction[] }> {
  const message = (input.message ?? "").trim();
  if (!message) {
    const err = new Error("Message is required") as Error & { code?: string };
    err.code = "INVALID_DATA";
    throw err;
  }

  const ar = isArabic(message);

  // Best-effort REAL context — never block the answer on a context failure.
  const ctx: AssistantContext = {};
  let dbUserId: string | null = null;

  try {
    const user = await getOrCreateUser(clerkId);
    ctx.role = user?.role ?? null;
    ctx.name = user?.name ?? null;
    dbUserId = user?.id ?? null;
  } catch {
    /* context is optional */
  }

  const [metricsRes, searchesRes, listingsRes, convosRes] = await Promise.allSettled([
    getMyMetrics(clerkId),
    listMySavedSearches(clerkId),
    dbUserId ? getDealerListings(dbUserId, { limit: 8 }) : Promise.resolve({ items: [] as DealerListing[] }),
    listConversations(clerkId),
  ]);

  ctx.metrics = metricsRes.status === "fulfilled" ? metricsRes.value : null;
  ctx.savedSearches =
    searchesRes.status === "fulfilled"
      ? searchesRes.value.slice(0, 5).map((s) => s.name || s.query || "").filter(Boolean)
      : [];
  ctx.listings = listingsRes.status === "fulfilled" ? listingsRes.value.items.slice(0, 8) : [];
  ctx.conversations = convosRes.status === "fulfilled" ? convosRes.value.slice(0, 6) : [];

  const validConversationIds = new Set((ctx.conversations ?? []).map((c) => c.id));

  const history: ChatMessage[] = (input.history ?? [])
    .filter(
      (m): m is AssistantTurn =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT) }));

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(ctx) },
    ...history,
    { role: "user", content: message.slice(0, MAX_CONTENT) },
  ];

  // Deterministic, server-built actions accumulated from the tool calls.
  let listingActions: AssistantAction[] = [];
  let searchAction: AssistantAction | null = null;
  const navActions = new Map<AssistantScreen, AssistantAction>();
  const convActions = new Map<string, AssistantAction>();

  let answer = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const lastRound = round === MAX_TOOL_ROUNDS - 1;
    const completion = await openai.chat.completions.create({
      // Backend-aware default: a direct OPENAI_API_KEY resolves to a real
      // OpenAI model, the managed integration to its own catalog. OPENAI_MODEL
      // overrides both when an operator wants to pin a specific model.
      model: process.env.OPENAI_MODEL ?? defaultChatModel(),
      max_completion_tokens: maxCompletionTokens(),
      messages,
      // On the final allowed round, force a text answer so we never end on a tool call.
      ...(lastRound ? { tool_choice: "none" as const } : { tools: TOOLS, tool_choice: "auto" as const }),
    });

    const choice = completion.choices[0];
    const msg = choice?.message;
    if (!msg) break;

    messages.push(msg as ChatMessage);
    const toolCalls = msg.tool_calls ?? [];

    if (toolCalls.length === 0) {
      answer = msg.content?.trim() ?? "";
      break;
    }

    for (const tc of toolCalls) {
      if (tc.type !== "function") continue;
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        parsedArgs = {};
      }

      let toolContent = "";

      if (tc.function.name === "search_marketplace") {
        try {
          const { items, query, parsed } = await runMarketplaceSearch(parsedArgs);
          if (items.length === 0) {
            toolContent = "No matching active listings were found.";
            listingActions = [];
            searchAction = searchActionFor(query, parsed, ar);
          } else {
            toolContent = JSON.stringify(
              items.map((it) => ({
                id: it.id,
                title: it.title,
                price: it.price_display,
                location: it.location,
                installment: it.installment_badge,
                trust: it.trust_signal,
                best_offer: it.best_offer_badge,
              })),
            );
            // Listing cards reflect the latest search only.
            listingActions = items.slice(0, MAX_LISTING_ACTIONS).map((it) => ({
              kind: "listing" as const,
              label: it.title,
              listing_id: it.id,
              price_display: it.price_display,
              thumbnail_url:
                it.media_preview ??
                (it as { thumbnail_url?: string | null }).thumbnail_url ??
                null,
              location: it.location,
            }));
            searchAction = searchActionFor(query, parsed, ar);
          }
        } catch {
          toolContent = "The marketplace search is temporarily unavailable.";
        }
      } else if (tc.function.name === "open_app_screen") {
        const screen = parsedArgs.screen as AssistantScreen;
        if (SCREENS.includes(screen)) {
          navActions.set(screen, {
            kind: "navigate",
            label: SCREEN_LABELS[screen][ar ? "ar" : "en"],
            screen,
          });
          toolContent = `Shortcut to the ${screen} screen attached.`;
        } else {
          toolContent = "Unknown screen; not attached.";
        }
      } else if (tc.function.name === "open_conversation") {
        const id = typeof parsedArgs.conversation_id === "string" ? parsedArgs.conversation_id : "";
        if (id && validConversationIds.has(id)) {
          const convo = (ctx.conversations ?? []).find((c) => c.id === id);
          convActions.set(id, {
            kind: "conversation",
            label: convo
              ? (ar ? `محادثة ${convo.counterparty_name}` : `Chat with ${convo.counterparty_name}`)
              : (ar ? "فتح المحادثة" : "Open conversation"),
            conversation_id: id,
          });
          toolContent = "Shortcut to that conversation attached.";
        } else {
          toolContent = "That conversation id is not one of the user's threads; not attached.";
        }
      } else {
        toolContent = "Unknown tool.";
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: toolContent,
      } as ChatMessage);
    }
  }

  if (!answer) {
    answer = ar
      ? "مش قادر أجاوب دلوقتي. حاول تاني."
      : "I couldn't generate a response right now. Please try again.";
  }

  // Assemble actions: listings first (most concrete), then their "see all"
  // search, then conversation shortcuts, then screen shortcuts.
  const actions: AssistantAction[] = [
    ...listingActions,
    ...(searchAction ? [searchAction] : []),
    ...convActions.values(),
    ...navActions.values(),
  ];

  return { answer, actions };
}
