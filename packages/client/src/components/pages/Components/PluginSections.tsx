import { Plug } from "lucide-react";
import { pluginGalleries } from "../../../../../plugins/galleryRegistry.ts";
import { GallerySection, StackedSpecimen } from "./Specimen.tsx";

export function PluginSections() {
  return (
    <>
      {pluginGalleries.map((gallery) => (
        <GallerySection
          key={gallery.id}
          id={gallery.id}
          title={gallery.title}
          description={gallery.description}
          icon={<Plug size={18} />}
        >
          {gallery.specimens.map(({ label, Component }) => (
            <StackedSpecimen key={label} label={label}>
              <Component />
            </StackedSpecimen>
          ))}
        </GallerySection>
      ))}
    </>
  );
}
