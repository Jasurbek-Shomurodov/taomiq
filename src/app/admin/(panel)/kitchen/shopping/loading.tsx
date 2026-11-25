import { PageSkeleton } from "../../../kit/Skeleton";

/** The shopping list: the day switcher, then the ingredients table. */
export default function Loading() {
  return <PageSkeleton layout="table" />;
}
