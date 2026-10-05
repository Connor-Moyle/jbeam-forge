// JBeam Forge's screen in the game: a full-screen route that F10 opens (lua/ge/extensions/jbeamForge.lua).
import { useBridge } from "@/bridge"
import JBeamForge from "./JBeamForge.vue"

const { lua } = useBridge()
const sourceId = "jbeamForge.routes"
const routes = [
  {
    path: "/jbeam-forge",
    name: "jbeamForge",
    component: JBeamForge,
    meta: {
      luaRoute: {
        title: "JBeam Forge",
        backTarget: "play",
      },
    },
  },
]

function toLuaRoutes(records) {
  return records.map(record => ({
    name: record.name,
    path: record.path,
    meta: record.meta,
  }))
}

export async function onLoad() {
  window.bngRoutes.add([{ path: sourceId, routes }])
  const result = await lua.extensions.ui_router_routeManager.registerModRoutes(sourceId, toLuaRoutes(routes))
  if (!result?.success) {
    window.bngRoutes.remove([sourceId])
    console.error("JBeam Forge: the screen could not be registered", result?.errors)
  }
}

export async function onUnload() {
  window.bngRoutes.remove([sourceId])
  await lua.extensions.ui_router_routeManager.unregisterModRoutes(sourceId, { fallbackRoute: "play" })
}
