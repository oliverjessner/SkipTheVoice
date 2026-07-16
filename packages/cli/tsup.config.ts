import{defineConfig}from"tsup";export default defineConfig({entry:["src/index.ts"],format:["esm"],platform:"node",outDir:"dist",clean:true,noExternal:["@skipthevoice/core"]});
