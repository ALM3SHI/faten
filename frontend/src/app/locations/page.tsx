"use client";

/**
 * Campus indoor map (/locations). The map data (src/data/map-data.json) is
 * only imported from this route's components, so no other page pulls it in.
 */

import { Suspense } from "react";
import { LocationsContent } from "@/components/locations/locations-view";

// Suspense boundary for useSearchParams inside the view.
export default function LocationsPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center text-muted-foreground">
          جاري تحميل الخريطة...
        </div>
      }
    >
      <LocationsContent />
    </Suspense>
  );
}
