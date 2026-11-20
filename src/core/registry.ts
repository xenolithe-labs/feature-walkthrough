import type { AnyAnnotation, AnyPanel } from './types';

/** Holds the panel types and annotation plugins a build knows about. */
export class Registry {
  private readonly panelTypes = new Map<string, AnyPanel>();
  private readonly annotationPlugins = new Map<string, AnyAnnotation>();

  registerPanel(panel: AnyPanel): this {
    if (this.panelTypes.has(panel.id)) {
      throw new Error(`panel type "${panel.id}" is already registered`);
    }
    this.panelTypes.set(panel.id, panel);
    return this;
  }

  registerAnnotation(plugin: AnyAnnotation): this {
    if (this.annotationPlugins.has(plugin.id)) {
      throw new Error(`annotation plugin "${plugin.id}" is already registered`);
    }
    this.annotationPlugins.set(plugin.id, plugin);
    return this;
  }

  panel(id: string): AnyPanel | undefined {
    return this.panelTypes.get(id);
  }

  annotation(id: string): AnyAnnotation | undefined {
    return this.annotationPlugins.get(id);
  }

  panelIds(): string[] {
    return [...this.panelTypes.keys()];
  }

  annotationIds(): string[] {
    return [...this.annotationPlugins.keys()];
  }
}
