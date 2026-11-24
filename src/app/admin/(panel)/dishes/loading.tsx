import { PageSkeleton } from "../../kit/Skeleton";

/** Dishes: the toolbar over the photo cards (the default view; the page itself knows the chosen one). */
export default function Loading() {
  return <PageSkeleton layout="cards" />;
}
