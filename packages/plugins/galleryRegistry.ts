import type { PluginGallery } from "./pluginOptions.ts";
import { ocppGallery } from "./chargers/ocpp/client/gallery.tsx";
import { goodweGallery } from "./energy/goodwe-sems/client/gallery.tsx";
import { powerwallGallery } from "./energy/powerwall2-local/client/gallery.tsx";

// Plugin-owned static specimens: never mount query/mutation wrappers here.
export const pluginGalleries: PluginGallery[] = [
  powerwallGallery,
  ocppGallery,
  goodweGallery,
];
