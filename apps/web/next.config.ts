import type { NextConfig } from "next";
const config:NextConfig={output:"standalone",serverExternalPackages:["@skipthevoice/core","better-sqlite3","@whiskeysockets/baileys"]};
export default config;
