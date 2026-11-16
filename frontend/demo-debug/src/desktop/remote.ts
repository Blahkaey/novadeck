// A browser stand-in for the host's native, script-free settings window. It never connects
// to a runner, saves a credential or restarts the desktop app.
export type RemoteScenario = {
  readonly label: string
  readonly hint: string
  readonly state:
    | "local"
    | "connecting"
    | "connected"
    | "disconnected"
    | "checking"
    | "unreachable"
    | "invalid"
    | "refused"
    | "write-failed"
    | "launch-failed"
}

let showing: HTMLDialogElement | undefined

export const showRemoteSettings = ({ state }: RemoteScenario): void => {
  showing?.remove()
  const dialog = document.createElement("dialog")
  showing = dialog
  dialog.setAttribute("aria-label", "Remote Runner")
  Object.assign(dialog.style, {
    width: "460px",
    maxWidth: "90vw",
    padding: "20px",
    borderRadius: "8px",
    colorScheme: "light dark",
    font: "13px system-ui, sans-serif",
  })
  if (state === "launch-failed") {
    dialog.innerHTML = `<h2>Novadeck can't connect to its remote runner</h2><p>The settings file is not a remote runner's settings: it is not JSON.</p><button>Open Settings…</button> <button data-quit>Quit</button>`
    dialog.querySelector("button")!.addEventListener("click", () =>
      showRemoteSettings({
        state: "invalid",
        label: "",
        hint: "",
      }),
    )
    dialog.querySelector("[data-quit]")!.addEventListener("click", () => dialog.remove())
    dialog.addEventListener("cancel", () => dialog.remove())
    document.body.append(dialog)
    dialog.showModal()
    return
  }
  const host =
    state === "local"
      ? "This computer"
      : `runner.example · ${state === "connecting" ? "Connecting…" : state === "disconnected" ? "Disconnected" : "Connected"}`
  dialog.innerHTML = `
    <h2 style="margin:0 0 12px;font-size:18px">Remote Runner</h2>
    <p data-status></p>
    <p>Terminals, agents and files belong to the computer running the runner.</p>
    <form autocomplete="off">
      <fieldset style="border:0;padding:0;margin:0">
        <label>Address<input name="url" required></label>
        <label>Token<input name="token" type="password" autocomplete="off"></label>
        <label>Pages proxy (optional)<input name="pagesProxy" placeholder="socks5://127.0.0.1:1080"></label>
        <p>Pages load through this proxy from the runner's computer.</p>
        <p role="alert"></p>
        <div style="display:flex;justify-content:flex-end;gap:12px"><button type="button" data-cancel>Cancel</button><button data-save>Save and Restart</button></div>
        <button type="button" data-local style="margin-top:20px">Use this computer's runner</button>
      </fieldset>
    </form>`
  dialog.querySelector("[data-status]")!.textContent = host
  const form = dialog.querySelector("form")!
  for (const label of form.querySelectorAll("label"))
    Object.assign(label.style, { display: "block", fontWeight: "600" })
  for (const input of form.querySelectorAll("input"))
    Object.assign(input.style, {
      boxSizing: "border-box",
      display: "block",
      width: "100%",
      padding: "6px 8px",
      margin: "4px 0 14px",
      font: "13px monospace",
    })
  const address = form.elements.namedItem("url") as HTMLInputElement
  address.value = state === "local" ? "" : "wss://runner.example/api/rpc"
  const token = form.elements.namedItem("token") as HTMLInputElement
  token.placeholder =
    state === "local" ? "The runner's NOVADECK_TOKEN" : "Leave blank to keep the saved token"
  const problem = dialog.querySelector<HTMLElement>('[role="alert"]')!
  problem.style.color = "#c0392b"
  const reasons: Partial<Record<RemoteScenario["state"], string>> = {
    invalid: '"url" must be a ws: or wss: address, such as ws://127.0.0.1:8787/api/rpc',
    refused: "The runner refused the token. Check that it matches the runner's NOVADECK_TOKEN.",
    unreachable:
      "The runner could not be reached within 10 seconds. Check its address, that it is running, and your network connection.",
    "write-failed":
      "The connection settings could not be saved. Check that the app's data folder is writable.",
    "launch-failed":
      "The remote runner settings could not be read. Open Settings… to fix them, or Quit.",
  }
  problem.textContent = reasons[state] ?? ""
  const save = dialog.querySelector<HTMLButtonElement>("[data-save]")!
  if (state === "checking") {
    form.querySelector("fieldset")!.disabled = true
    save.textContent = "Checking connection…"
  }
  const local = dialog.querySelector<HTMLButtonElement>("[data-local]")!
  local.hidden = state === "local"
  const close = (): void => {
    dialog.remove()
    if (showing === dialog) showing = undefined
  }
  dialog.querySelector("[data-cancel]")!.addEventListener("click", close)
  dialog.addEventListener("cancel", close)
  local.addEventListener("click", () => {
    problem.textContent = "Remote settings kept. The app would restart on this computer's runner."
  })
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    token.value = ""
    problem.textContent =
      reasons[state] ?? "Connection checked. The app would save its settings and restart."
  })
  document.body.append(dialog)
  dialog.showModal()
}
