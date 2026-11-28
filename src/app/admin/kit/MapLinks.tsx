import { MapPin } from "lucide-react";
import { formatLocation, googleMapsUrl, yandexMapsUrl, type LatLng } from "@/lib/order/location";

/**
 * The customer's shared map point (migration 0032) as two links, Yandex Maps first (what couriers in Tashkent use),
 * each in a new tab without a referrer. On paper the links give way to the point as text (`printLabel: 41.311081,
 * 69.240562`). data-ph-mask: the point is personal data, like the address beside it.
 */
export function MapLinks({
  location,
  yandex,
  google,
  printLabel,
  className = "",
}: {
  location: LatLng;
  yandex: string;
  google: string;
  /** Shown before the point on paper; without it nothing prints. */
  printLabel?: string;
  className?: string;
}) {
  const link =
    "inline-flex min-h-9 items-center gap-1 whitespace-nowrap text-[13px] font-medium text-adm-accent-ink underline-offset-4 hover:underline";
  return (
    <span className={`block ${className}`} data-ph-mask>
      <span className="adm-no-print flex flex-wrap items-center gap-x-4">
        <a href={yandexMapsUrl(location)} target="_blank" rel="noopener noreferrer" className={link}>
          <MapPin aria-hidden="true" className="size-3.5" />
          {yandex}
        </a>
        <a href={googleMapsUrl(location)} target="_blank" rel="noopener noreferrer" className={link}>
          {google}
        </a>
      </span>
      {printLabel && (
        <span className="adm-print-only text-[13px] tabular-nums">
          {printLabel}: {formatLocation(location)}
        </span>
      )}
    </span>
  );
}
