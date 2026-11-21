import { PointerSensor, type Draggable, type PointerSensorOptions } from "@dnd-kit/dom"
import { isHTMLElement } from "@novadeck/toolkit/realm"

// Whether `sensor` took the press up: dnd-kit marks the event with the sensor that did.
const takenBy = (event: PointerEvent, sensor: PointerSensor): boolean =>
  (event as PointerEvent & { readonly sensor?: unknown }).sensor === sensor

// dnd-kit's pointer sensor for a panel's rows, which may be drawn in a window of the panel's own:
// dnd-kit follows a press's moves and its release on the page's document and its frames alone,
// so in another window of the page a drag never starts. This one follows them in the document of
// the row pressed too, where that is another.
export class PanelPointerSensor extends PointerSensor {
  // Stops following the press in the other document.
  #unbinds: (() => void)[] = []

  static override configure = (options: PointerSensorOptions) => ({
    plugin: PanelPointerSensor,
    options,
  })

  protected override handlePointerDown(
    event: PointerEvent,
    source: Draggable,
    options: PointerSensorOptions | undefined,
  ): void {
    super.handlePointerDown(event, source, options)
    const page = source.element?.ownerDocument ?? document
    // Not taken up as a press by this sensor, as another pointer's while one drags, or in the
    // page's own document, which dnd-kit follows itself.
    if (!takenBy(event, this) || page === document) return
    const { pointerId, target } = event
    const nativelyDraggable =
      isHTMLElement(target) && target.draggable && target.getAttribute("draggable") === "true"
    const forPointer =
      (listener: (event: PointerEvent) => void) =>
      (each: Event): void => {
        if ((each as PointerEvent).pointerId === pointerId) listener(each as PointerEvent)
      }
    this.#unbinds.push(
      this.listeners.bind(page, [
        {
          type: "pointermove",
          listener: forPointer((moved) => this.handlePointerMove(moved, source)),
        },
        {
          type: "pointerup",
          // Private in dnd-kit's types, and bound to the sensor, as the page's own listener is:
          // its handling of a drop, as suppressing the click that follows, is dnd-kit's own
          // (panel-drag.test.ts holds it to that).
          listener: forPointer(this["handlePointerUp"]),
          options: { capture: true },
        },
        { type: "pointercancel", listener: forPointer(this.handleCancel) },
        // A native drag there competes with this one, as on the page.
        {
          type: "dragstart",
          listener: nativelyDraggable ? this.handleCancel : (each) => each.preventDefault(),
          options: { capture: true },
        },
      ]),
    )
  }

  protected override cleanup(): void {
    super.cleanup()
    for (const unbind of this.#unbinds.splice(0)) unbind()
  }
}
