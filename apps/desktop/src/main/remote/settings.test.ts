import { context, describe, expect, it } from "../../test"
import { readRemoteSettings, remoteSettingsOf } from "./settings"

const token = "desktop-tests-only-not-a-production-credential"
const url = "ws://127.0.0.1:8787/api/rpc"

const settings = (fields: Record<string, unknown>): string =>
  JSON.stringify({ url, token, ...fields })

describe("remoteSettingsOf", () => {
  it("reads a runner an SSH tunnel brings to this machine", () => {
    expect(remoteSettingsOf(settings({}))).toEqual({ url, token })
  })

  it("reads the proxy the companion pane's pages load through, as its origin", () => {
    expect(remoteSettingsOf(settings({ pagesProxy: " socks5://127.0.0.1:1080/ " }))).toEqual({
      url,
      token,
      pagesProxy: "socks5://127.0.0.1:1080",
    })
  })

  it("takes an encrypted address on any machine", () => {
    const remote = "wss://deck.example.test/api/rpc"
    expect(remoteSettingsOf(settings({ url: remote })).url).toBe(remote)
  })

  context("when the settings can't be used", () => {
    it.each([
      ["not JSON", "{", "not JSON"],
      ["no object", "[]", "JSON object"],
      ["no address", settings({ url: undefined }), '"url"'],
      ["an address that is no WebSocket's", settings({ url: "http://127.0.0.1:8787" }), '"url"'],
      [
        "an unencrypted address on another machine",
        settings({ url: "ws://192.168.1.20:8787/api/rpc" }),
        "unencrypted",
      ],
      ["a token too short to be a runner's", settings({ token: "short" }), '"token"'],
      ["a proxy without a port", settings({ pagesProxy: "socks5://127.0.0.1" }), '"pagesProxy"'],
      [
        "a proxy of a kind it can't use",
        settings({ pagesProxy: "ftp://127.0.0.1:21" }),
        '"pagesProxy"',
      ],
    ])("refuses %s", (_name, text, said) => {
      expect(() => remoteSettingsOf(text)).toThrow(said)
    })

    it("never says the token", () => {
      const text = settings({ url: "ws://192.168.1.20:8787/api/rpc" })
      expect(() => remoteSettingsOf(text)).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining(token) as string }),
      )
    })
  })
})

describe("readRemoteSettings", () => {
  const file = "/data/remote-runner.json"
  const missing = () => Promise.reject(Object.assign(new Error("no file"), { code: "ENOENT" }))

  it("names no remote runner where there is no file", async () => {
    await expect(readRemoteSettings(file, missing)).resolves.toBeUndefined()
  })

  it("reads the file's settings", async () => {
    await expect(readRemoteSettings(file, () => Promise.resolve(settings({})))).resolves.toEqual({
      url,
      token,
    })
  })

  it("names the file whose settings can't be used, and what is wrong with them", async () => {
    await expect(readRemoteSettings(file, () => Promise.resolve("{"))).rejects.toThrow(
      `${file} is not a remote runner's settings: it is not JSON`,
    )
  })

  it("names the file it can't read", async () => {
    const denied = () => Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
    await expect(readRemoteSettings(file, denied)).rejects.toThrow(`${file} could not be read`)
  })
})
