import { absolutePath, relativePath } from "./files"
import { context, describe, expect, it } from "./test"

describe("a path from a project's directory", () => {
  context("written whole, as the backend's machine knows it", () => {
    it("joins with the separator the directory uses", () => {
      expect(absolutePath("/home/me/shop", "src/a.ts")).toBe("/home/me/shop/src/a.ts")
      expect(absolutePath("/home/me/shop/", "a.ts")).toBe("/home/me/shop/a.ts")
      expect(absolutePath("C:\\Users\\me\\shop", "src/a.ts")).toBe("C:\\Users\\me\\shop\\src\\a.ts")
    })
  })

  context("written from the project's root", () => {
    it("keeps its slashes where the directory has them", () => {
      expect(relativePath("/home/me/shop", "src/cart/a.ts")).toBe("src/cart/a.ts")
      expect(relativePath("~/projects/shop", "a.ts")).toBe("a.ts")
    })

    it("takes backslashes in a Windows directory, as the whole path does", () => {
      expect(relativePath("C:\\Users\\me\\shop", "src/cart/a.ts")).toBe("src\\cart\\a.ts")
      expect(absolutePath("C:\\Users\\me\\shop", "src/cart/a.ts")).toBe(
        `C:\\Users\\me\\shop\\${relativePath("C:\\Users\\me\\shop", "src/cart/a.ts")}`,
      )
    })
  })
})
