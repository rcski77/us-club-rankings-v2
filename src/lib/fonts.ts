import { Archivo, IBM_Plex_Mono } from "next/font/google";

// Brand wordmark font (see the SVG lockups this pairs with, public/brand/*.svg) --
// only loaded where the public-facing pages/logo render, not the admin app, which
// keeps its own plain system-font styling untouched.
export const archivo = Archivo({ subsets: ["latin"], weight: ["800", "900"] });
export const ibmPlexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500"] });
