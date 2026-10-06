<template>
  <div ref="host" class="jbeam-forge-host">
    <div v-if="problem" class="jbeam-forge-problem">
      <h2>JBeam Forge couldn’t start</h2>
      <p>{{ problem }}</p>
      <p>Press F10 to go back to the game.</p>
    </div>
  </div>
</template>

<script setup>
// Mounts JBeam Forge (the same app as the desktop version, built as forge.mjs) and gives it the
// game: every service it needs goes through jbeamForge.lua.
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue"
import { useBridge } from "@/bridge"

// The game compiles this file itself, so paths are from the UI's root rather than this file.
const BASE = "/ui/ui-vue/mods/jbeamForge/"
const host = ref(null)
const problem = ref("")
const { api, events, lua } = useBridge()
// The bridge only wraps the game's own functions, so ours are called as Lua code.
const callLua = (code) => new Promise(resolve => api.engineLua(code, resolve))
const forgeCall = (channel, json) => callLua(`extensions.jbeamForge.call(${api.serializeToLua(channel)}, ${api.serializeToLua(json)})`)
// JSON with everything past ASCII escaped: the game's Lua strings don't take other characters well.
const asciiJson = (value) => JSON.stringify(value ?? null).replace(/[\u007f-\uffff]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
let unmount = null
let stylesheet = null
let gone = false

// Tell the game's router the screen is up (it gives up on a route that doesn't say so).
async function acknowledgeMount() {
  await nextTick()
  const router = window.__luaRouter__
  const result = await lua.extensions.ui_router.routeMounted(router?._pendingCanonicalRoute || "jbeamForge")
  if (result?.success && router) router._pendingCanonicalRoute = null
  if (!result?.success) callLua(`log("W", "jbeamForge", ${api.serializeToLua("the router did not take the screen: " + JSON.stringify(result))})`)
}

function report(stage, err) {
  const message = err && err.message ? err.message : String(err)
  problem.value = message
  forgeCall("selftest:report", JSON.stringify({ mounted: false, stage, error: message }))
  console.error("JBeam Forge: " + stage, err)
}

onMounted(async () => {
  // Tell the router first, then load: loading first kept the router waiting until it gave up.
  await acknowledgeMount()
  await new Promise(resolve => setTimeout(resolve, 30))
  stylesheet = document.createElement("link")
  stylesheet.rel = "stylesheet"
  stylesheet.href = new URL(BASE + "forge.css", window.location.href).href
  document.head.appendChild(stylesheet)
  let forge
  try {
    forge = await import(/* @vite-ignore */ new URL(BASE + "forge.mjs", window.location.href).href)
  } catch (err) {
    report("loading forge.mjs", err)
    return
  }
  if (gone) return
  try {
    unmount = forge.mountForge(host.value, {
      base: BASE,
      call: (channel, req) => forgeCall(channel, asciiJson(req)).then(text => JSON.parse(text)),
      on: (name, listener) => {
        events.on(name, listener)
        return () => events.off(name, listener)
      },
    })
  } catch (err) {
    report("starting", err)
  }
})

onBeforeUnmount(() => {
  gone = true
  if (unmount) unmount()
  if (stylesheet) stylesheet.remove()
  callLua("extensions.jbeamForge.close()")
})
</script>

<style scoped>
.jbeam-forge-host {
  position: absolute;
  inset: 0;
  z-index: 100;
  pointer-events: auto;
}
.jbeam-forge-problem {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #1a1d22;
  color: #e8e8e8;
  font-family: sans-serif;
}
</style>
