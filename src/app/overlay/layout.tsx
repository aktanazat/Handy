import type { Metadata } from "next";

/* Only here to name the window: the page itself is a client component and a
 * client component cannot export metadata. */
export const metadata: Metadata = {
  title: "Recording Overlay",
};

export default function OverlayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
