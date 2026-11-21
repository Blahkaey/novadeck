import { DragDropManager, Draggable, PointerActivationConstraints } from "@dnd-kit/dom"

import { context, describe, expect, it } from "../test"
import { PanelPointerSensor } from "./panel-drag"

// A row in another document than the page's, as in a panel's window of its own, which drags
// once the pointer has moved a pixel. (A document of the page's own realm: jsdom can't take a
// frame's listeners with the page's signals, as a browser does.)
const dragging = () => {
  const other = document.implementation.createHTMLDocument("Notes")
  const row = other.createElement("div")
  other.body.append(row)
  // The pointer is held by the body while it drags, which jsdom has no way to do.
  other.body.setPointerCapture = () => {}
  const manager = new DragDropManager({
    plugins: [],
    sensors: [
      PanelPointerSensor.configure({
        activationConstraints: [new PointerActivationConstraints.Distance({ value: 1 })],
      }),
    ],
  })
  manager.registry.register(new Draggable({ id: "row", element: row }, manager))
  const pointer = (type: string, x: number, init: PointerEventInit = {}): PointerEvent =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      isPrimary: true,
      pointerId: 1,
      button: 0,
      clientX: x,
      clientY: 10,
      ...init,
    })
  return { other, row, manager, pointer }
}

// Lets a drag that was told to start or stop get there.
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

describe("a panel row's pointer sensor", () => {
  context("for a row in another document than the page's", () => {
    it("follows the press there, and the release there ends the drag", async () => {
      const { other, row, manager, pointer } = dragging()

      row.dispatchEvent(pointer("pointerdown", 10))
      other.dispatchEvent(pointer("pointermove", 40))
      await settled()
      expect(manager.dragOperation.status.dragging).toBe(true)
      other.dispatchEvent(pointer("pointerup", 40))
      await settled()

      expect(manager.dragOperation.status.idle).toBe(true)
    })

    it("keeps a native drag from starting there while pressed", () => {
      const { row, pointer } = dragging()

      row.dispatchEvent(pointer("pointerdown", 10))
      const started = new Event("dragstart", { bubbles: true, cancelable: true })
      row.dispatchEvent(started)

      expect(started.defaultPrevented).toBe(true)
    })

    it("leaves another pointer pressed meanwhile to the first one's drag", async () => {
      const { other, row, manager, pointer } = dragging()

      row.dispatchEvent(pointer("pointerdown", 10))
      row.dispatchEvent(pointer("pointerdown", 10, { pointerId: 2, isPrimary: false }))
      other.dispatchEvent(pointer("pointermove", 40))
      await settled()
      other.dispatchEvent(pointer("pointerup", 40, { pointerId: 2 }))
      await settled()

      expect(manager.dragOperation.status.dragging).toBe(true)
    })
  })
})
