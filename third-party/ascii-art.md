# Start screen aircraft

auracode's start screen shows one American military aircraft drawn in text, a different one at
each launch (`apps/desktop/src/components/chat/LaunchArt.tsx`). The fifteen pieces in
`apps/desktop/src/components/chat/launch-art/` are published text art, not drawn for auracode: the
owner asked for existing art that looks like the real aircraft (7 November 2026: "not make your
own, but pull up some. It needs to look like the exact thing"). They are used at the owner's
direction while the owner handles permissions (2026-11-07).

**Each piece remains its artist's work.** It is not part of auracode, is not covered by auracode's
license (whichever the owner chooses), and is not licensed to anyone who copies this repository.
Text-art archives share these pieces for copying with the artist's name kept, and auracode keeps
it: under each piece on the start screen, and here. Unsigned pieces were unsigned at their source.

Retrieved 2026-11-07. Hashes are SHA-256 of the stored file (LF line endings, final newline).

## What changed from the source

- **Kept as drawn.** Every stroke, space and signature inside a piece is as published, including
  the signatures drawn into the art (dew, Billcow168) and its lettering (USAF, Mustangs Forever).
- **Cut from the archive around it.** The credit lines the archives print beside or under a piece
  (name, e-mail, university) are left out and the name shows under the piece instead. The common
  indentation and trailing spaces are removed, which moves no stroke relative to another.
- **One title removed.** The SR-71 front view's archive copy has the words "SR-71" and "BLACKBIRD"
  written beside its left wing; they are blanked to spaces, since the start screen names it.
- **Braille dot art.** No good ASCII drawing of the B-2, F-22 or F-35 could be found. These three
  are Braille dot art (Unicode U+2800 to U+28FF), whose finer dots hold a close likeness, copied
  from emojicombos.com, where they were submitted unsigned.

## Pieces

| File | Aircraft | Artist | Source | SHA-256 |
| --- | --- | --- | --- | --- |
| `a-10-thunderbolt-ii.txt` | A-10 Thunderbolt II | Mike Whaley | [air.txt][air] | `e7d493568b5012ed0de569bebfb38c63614233513f3fc34c2b83ce80d363efbe` |
| `b-2-spirit.txt` | B-2 Spirit | Unsigned | [emojicombos.com/b2-bomber][b2] | `effb21125ef36056f3e5c84ea75702b8589493de6820acb9dda8639a908922f6` |
| `f-117-nighthawk-front.txt` | F-117 Nighthawk | Unsigned | [air.txt][air] | `037ada6d8fd3f33aa58b28b11d1f7a1abe1f61fc76c16771544038b124195882` |
| `f-117-nighthawk.txt` | F-117 Nighthawk | Joshua Bell | [air.txt][air] | `3a779685881f4075e36f95887fa5ffef060796241a55c0cafb0bc07a61e09a5d` |
| `f-14-tomcat-front.txt` | F-14 Tomcat | Unsigned ("Source Unknown") | [ascii-art.de fighter][de] | `7bf6f7d49aeaa008c06e0260b9b6d08340b68331e25b6a4efd35bb52ec3ad43b` |
| `f-14-tomcat.txt` | F-14 Tomcat | Unsigned | [air.txt][air] | `bc9cf7ff9dee5194c0d0002ebc5fda1334abead4b8d6563b8454b6ec0a3503db` |
| `f-15-eagle.txt` | F-15 Eagle | Radeon350 | [ascii-art.de fighter][de] | `5abb1bb83a53afc6ba91137798bdbaed96d1ba8a17331c3170ccd21d3f160b4a` |
| `f-16-fighting-falcon.txt` | F-16 Fighting Falcon | dew | [ascii-art.de fighter][de] | `be9e12ecafec58ef034a7feeabe747f230cb14ae8bdb15936423bbe375b77a3c` |
| `f-22-raptor.txt` | F-22 Raptor | Unsigned | [emojicombos.com/jet-ascii-art][jet] | `04b2b743a5c8015d06e15a3a074ff6ebdc3d39ef13920884abb53c8f8e0b39be` |
| `f-35-lightning-ii.txt` | F-35 Lightning II | Unsigned | [emojicombos.com/f-22-ascii-art][f22] ("F-35A Fighter") | `c4badb3ff4db1d5be40f57d7aa4026435a5851e76323b7672ba7f41c297fec57` |
| `f4u-corsair.txt` | F4U Corsair | Andrew S. Townley | [air.txt][air] | `c7665352fdad7af72fdbcb107aeebbe4ca0935dcac82e75dbe6c834505d70427` |
| `p-51-mustang.txt` | P-51 Mustang | Larry E. Cunningham | [air.txt][air] | `dc4351b423d07b458459519b690a4b35f85b274f144d3ffee623b0fcd71267ec` |
| `sr-71-blackbird-front.txt` | SR-71 Blackbird | Sean Riesch | [air.txt][air] | `29743448da449413dfcf872b002b2f7f4668d87314b6df0fafc9ac60b7fd390e` |
| `sr-71-blackbird-top.txt` | SR-71 Blackbird | Unsigned | [air.txt][air] | `291e9f4158dbe053e3015fc0fb3cb5bb38bd616a45b14a976e0c1494180ac3c5` |
| `x-29.txt` | Grumman X-29 | Billcow168 | [ascii-art.de fighter][de] | `504c6d4dba59db3e51bb537dafc3d872a97e9612c24cd470f1881e9d31fac075` |

[air]: http://afrodita.rcub.bg.ac.rs/~ggajic/ascii/art/air.txt
[de]: https://www.ascii-art.de/ascii/def/fighter.txt
[b2]: https://emojicombos.com/b2-bomber
[jet]: https://emojicombos.com/jet-ascii-art
[f22]: https://emojicombos.com/f-22-ascii-art
