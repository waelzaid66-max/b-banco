import { useGetAdminListings } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useLang } from "@/context/LanguageContext";

export default function ListingsPage() {
  const { t } = useLang();
  const { data: listingsResp, isLoading } = useGetAdminListings();
  const listings = listingsResp?.data ?? [];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t("listingsPage.title")}</h1>
        <p className="text-muted-foreground mt-2">{t("listingsPage.subtitle")}</p>
      </div>

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("listingsPage.colListing")}</TableHead>
              <TableHead>{t("listingsPage.colCategory")}</TableHead>
              <TableHead>{t("listingsPage.colPrice")}</TableHead>
              <TableHead>{t("listingsPage.colStatus")}</TableHead>
              <TableHead>{t("listingsPage.colSeller")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                </TableCell>
              </TableRow>
            ) : !listings?.length ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  {t("listingsPage.empty")}
                </TableCell>
              </TableRow>
            ) : (
              listings.map((listing: (typeof listings)[number]) => (
                <TableRow key={listing.id}>
                  <TableCell>
                    <div className="font-medium truncate max-w-[300px]">{listing.title}</div>
                    <div className="text-xs text-muted-foreground">{new Date(listing.created_at!).toLocaleDateString()}</div>
                  </TableCell>
                  <TableCell className="capitalize">{listing.category}</TableCell>
                  <TableCell>{listing.price_display}</TableCell>
                  <TableCell>
                    <Badge variant={listing.status === "active" ? "default" : "secondary"}>
                      {listing.status?.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>{listing.seller_name}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
