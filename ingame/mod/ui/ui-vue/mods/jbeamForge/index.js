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

// The app is 5 MB of script: read it while the player is in the menus, not when F10 is pressed
// (parsing it then held up the screen past the router's 1.5 s and F10 seemed to do nothing).
function warmUp() {
  const base = "/ui/ui-vue/mods/jbeamForge/"
  const go = () => import(/* @vite-ignore */ new URL(base + "forge.mjs", window.location.href).href).catch(() => undefined)
  if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 20000 })
  else setTimeout(go, 8000)
}

export async function onLoad() {
  warmUp()
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
