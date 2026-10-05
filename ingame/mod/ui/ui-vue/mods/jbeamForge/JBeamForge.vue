<template>
  <div ref="host" class="jbeam-forge-host"></div>
</template>

<script setup>
// Mounts JBeam Forge (the same app as the desktop version, built as forge.mjs) and gives it the
// game: every service it needs goes through jbeamForge.lua.
import { onBeforeUnmount, onMounted, ref } from "vue"
import { useBridge } from "@/bridge"

const BASE = "/ui/ui-vue/mods/jbeamForge/"
const host = ref(null)
const { lua, events } = useBridge()
let unmount = null
let stylesheet = null

onMounted(async () => {
  stylesheet = document.createElement("link")
  stylesheet.rel = "stylesheet"
  stylesheet.href = BASE + "forge.css"
  document.head.appendChild(stylesheet)
  const forge = await import("./forge.mjs")
  unmount = forge.mountForge(host.value, {
    base: BASE,
    call: (channel, req) => lua.extensions.jbeamForge.call(channel, JSON.stringify(req ?? null)).then(text => JSON.parse(text)),
    on: (name, listener) => {
      events.on(name, listener)
      return () => events.off(name, listener)
    },
  })
})

onBeforeUnmount(() => {
  if (unmount) unmount()
  if (stylesheet) stylesheet.remove()
  lua.extensions.jbeamForge.close()
})
</script>

<style scoped>
.jbeam-forge-host {
  position: absolute;
  inset: 0;
  z-index: 100;
}
</style>
