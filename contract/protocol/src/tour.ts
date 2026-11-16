import { z } from "zod"

import { directory, id } from "./fields.js"
import { startupCommand } from "./terminals.js"

// A run of Novadeck's tour, readied by the runner (`tour.prepare`): the folder it runs in,
// the line that starts its agent there, and where that agent's first line goes: on the
// launch line itself (`launch`), or rung by the doorbell once its prompt shows, which the
// client asks for with `tour.brief` once the agent has shown in its terminal (`doorbell`).
// `model` is the one the agent starts on, where one was picked. `removed` are the projects
// that were open at the folder, which the runner removed before emptying it.
export const tourPrepared = z.strictObject({
  directory,
  command: startupCommand,
  brief: z.enum(["launch", "doorbell"]),
  model: z.string().min(1).max(200).optional(),
  removed: z.array(id).max(1000),
})
export type TourPrepared = z.infer<typeof tourPrepared>
