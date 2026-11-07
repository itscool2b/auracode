# Start screen aircraft

auracode's start screen shows one American military aircraft in ASCII, a different one at each
launch (`apps/desktop/src/components/chat/LaunchArt.tsx`). The owner asked for art that looks like
the exact aircraft, from images on the internet (7 November 2026: "It needs to look like the exact
thing", then "just actually put in images from the internet"). Each of the fifteen pieces in
`apps/desktop/src/components/chat/launch-art/` was made from a real image of that aircraft:
fourteen photographs (U.S. Air Force, U.S. Navy, U.S. Army Air Forces, and Convair's archive at the
San Diego Air & Space Museum) and one U.S. Air Force drawing, all public domain on Wikimedia
Commons. None needs attribution; the photographers are credited below anyway.

Retrieved 2026-11-07, at 1600 pixels wide. SHA-1 is Commons' hash of the original file; SHA-256 is
the stored text (LF line endings, final newline).

## How a photograph became ASCII

1. **The aircraft is cut out of its sky.** A smooth colour surface is fitted to the photograph's
   border, and whatever differs from it or has a strong edge is aircraft; gaps are bridged, holes
   filled and thin trails (vapour, contrails) dropped. The SR-71, shot over snow, is cut by
   darkness instead, and the X-29 drawing by its outline.
2. **It is shaded by its own light and dark**, kept within the darker part of the range so the
   silhouette stays whole, with a solid rim around the outline.
3. **Every character cell gets a glyph.** Each of `` .,:;'"`^-_~=+*!/\|()<>#%&@8WM`` is drawn in
   Geist Mono, as the app draws it, and the cell takes the one whose density matches its tone and,
   where the cell holds an edge, whose shape follows it.

The B-2 and the F/A-18 were turned (90 and 45 degrees) to show their planform level; nothing else
was redrawn. The converter ran once, outside the repository; it is not part of auracode.

## Pieces

| File | Aircraft | Photograph | Credit | License | SHA-1 (photo) | SHA-256 (text) |
| --- | --- | --- | --- | --- | --- | --- |
| `a-10-thunderbolt-ii.txt` | A-10 Thunderbolt II | [A-10 Thunderbolt of the 354th FS over the Netherlands in March 2015][a10] | U.S. Air Force photo by Senior Airman Damon Kasberg | Public domain | `abaa4637846fde9d5f505765210c52dd23ed6fc1` | `d2c65191f0b58c71da6ce7d8b3b1b9c823014ad1a68353178c7eca1906b5911a` |
| `b-1b-lancer.txt` | B-1B Lancer | [170916-F-HB600-0111][b1] | U.S. Air Force photo by Senior Airman Denise M. Jenson | Public domain | `3a6896527626e55b76e2c4432402b6940e93a9ce` | `47d99f73a69e892234ae205336865519950018f6dfaa6636ab8a268e8d5b0322` |
| `b-2-spirit.txt` | B-2 Spirit | [A B-2 Spirit flies over the Power in the Pines Open House and Air Show][b2] | U.S. Air Force photo by Tech. Sgt. Matt Hecht, 108th Wing | Public domain | `d48056d554c69319b63c228c190c61ab7e3c3d4d` | `948d58a9f4638e93ac8df568b23c594e25c88a61360cd5561355b85e71e27dab` |
| `f-117-nighthawk.txt` | F-117 Nighthawk | [F-117 Nighthawk Front][f117] | U.S. Air Force photo by Staff Sgt. Aaron Allmon II | Public domain | `074fb56c1fe5f8d454a7225e99dae175f0583945` | `0da60c55733a8fe0effdbc0d4d4fa8c63cd9385f10c6fdbad2108605a8d709d5` |
| `f-14-tomcat.txt` | F-14 Tomcat | [F-14A Tomcat VF-33 in flight 1982][f14] | U.S. Navy photo by George McGarry | Public domain | `20f2fe3df9c14860d7dc80427e5bc927ed8b2bbe` | `24885409cfe1eba5a21b935a62cb0b6c914f66054d3b4098a4699a9315a5a850` |
| `f-15-eagle.txt` | F-15 Eagle | [Defense.gov News Photo 050408-F-4905S-006][f15] | U.S. Air Force photo by Staff Sgt. Jeremy Smith | Public domain | `6248adc0319fa169d8d5a5bf5a88a5137775848e` | `ca4577da266d6a89be9bdfebcdea1704652a06e810bdfeedd7a1d720e518adb9` |
| `f-16-fighting-falcon.txt` | F-16 Fighting Falcon | [31 FW conducts ACE training during Agile Wyvern][f16] | U.S. Air Force photo by Senior Airman Brooke Moeder | Public domain | `d2ee8f63e9ff6eb221f2feb994e9e9043de98f47` | `08db47f23702e46621306c65767abb50cfe5eee7ba526aba3020526b4b15cd5e` |
| `f-22-raptor.txt` | F-22 Raptor | [F-22 Raptor edit1 (cropped)][f22] | U.S. Air Force photo by Master Sgt. Andy Dunaway | Public domain | `a5646b401882fc3b78bc3e6e553e8deb593e88fc` | `5fe2b6864898ef8e1704e383d361bcc090c05b6a202f70ed0bb0864478504991` |
| `f-35-lightning-ii.txt` | F-35 Lightning II | [F-35B Lightning II Asymmetric Flying Qualities Test][f35] | U.S. Navy (VX), via DVIDS | Public domain | `0436d2cf40bfd1913775fe7a5f39be2b52f8b13c` | `4d86e60dd05bb1b510802d9ad65a0f96353fe9dc65fc66129f95674d9f83b1da` |
| `f-4-phantom-ii.txt` | F-4 Phantom II | [Convair Negative Image - Tomahawk on F-4 Phantom][f4] | San Diego Air & Space Museum Archives | Public domain | `eda319a668073170002aafe4691f6dfa38ab36f1` | `f6d336b46d60febddf94c5682fbe83b19dee6ec58b5aabeae87320ec437577b4` |
| `f4u-corsair.txt` | F4U Corsair | [F4U-1 Corsair in flight c1942][f4u] | U.S. Navy | Public domain | `30b46b82ce34c9867856be6eaa5dc8a3db233314` | `d827fc47d67a513d2ba12672b19423e96f5a686a67ee1bf8921cce5008259786` |
| `fa-18-super-hornet.txt` | F/A-18 Super Hornet | [110531-N-DR144-569][fa18] | U.S. Navy photo (U.S. Department of Defense) | Public domain | `bd18f83c1c55fa3515d0340c5ef32faeb65db45e` | `eb207a4b8e48a826343b0b1760dc4ccad9b54a963c68c0d8a2f651240435a62c` |
| `p-51-mustang.txt` | P-51 Mustang | [P-51D Mustang "American Beauty", 31st FG, over Italy, 1944][p51] | U.S. Army Air Forces | Public domain | `56795fe53ff9a35229b5cf600a37cb5ff109ae9d` | `4293a93dacaf4b7e0954e852deb2a60089c3531242d2f322523276226c5d269e` |
| `sr-71-blackbird.txt` | SR-71 Blackbird | [Lockheed SR-71 in flight (SN 61-7968)][sr71] | National Museum of the U.S. Air Force | Public domain | `a4e76ca10e79b07d69b338c708453bc74dda0922` | `bd8c35f8802116172b67d3277ed9d7b320addef55e19c24937db152a21ccdd53` |
| `x-29.txt` | Grumman X-29 | [Grumman X-29 afg-041110-053][x29] | U.S. Air Force drawing | Public domain | `a9f118d1ebe7bbc47b5c99ba3ec9568ca6e4faa4` | `112ab620fda5d6a3d8c8832fef1ed8fa9ed13d12b1cd1a1d467df7629c8ebda5` |

[a10]: https://commons.wikimedia.org/wiki/File:A-10_Thunderbolt_of_the_354th_FS_over_the_Netherlands_in_March_2015.jpg
[b1]: https://commons.wikimedia.org/wiki/File:170916-F-HB600-0111.jpg
[b2]: https://commons.wikimedia.org/wiki/File:A_B-2_Spirit_flies_over_the_Power_in_the_Pines_Open_House_and_Air_Show_on_Joint_Base_McGuire-Dix-Lakehurst,_N.J._(27061449661).jpg
[f117]: https://commons.wikimedia.org/wiki/File:F-117_Nighthawk_Front.jpg
[f14]: https://commons.wikimedia.org/wiki/File:F-14A_Tomcat_VF-33_in_flight_1982.JPEG
[f15]: https://commons.wikimedia.org/wiki/File:Defense.gov_News_Photo_050408-F-4905S-006.jpg
[f16]: https://commons.wikimedia.org/wiki/File:31_FW_conducts_ACE_training_during_Agile_Wyvern_210908-F-ZR251-1194.jpg
[f22]: https://commons.wikimedia.org/wiki/File:F-22_Raptor_edit1_(cropped).jpg
[f35]: https://commons.wikimedia.org/wiki/File:F-35B_Lightning_II_Asymmetric_Flying_Qualities_Test_150713-D-DW096-355.jpg
[f4]: https://commons.wikimedia.org/wiki/File:23_0071114_Convair_Negative_Image_-_Tomahawk_on_F-4_Phantom_(54222731754).jpg
[f4u]: https://commons.wikimedia.org/wiki/File:F4U-1_Corsair_in_flight_c1942.jpg
[fa18]: https://commons.wikimedia.org/wiki/File:110531-N-DR144-569_(5804591946).jpg
[p51]: https://commons.wikimedia.org/wiki/File:44-15439-P-51D-Mustang-31FG308FS-HLB-American-Beauty-Capt-John-J-Voll-over-Italy-1944.jpg
[sr71]: https://commons.wikimedia.org/wiki/File:Lockheed_SR-71_in_flight_(SN_61-7968)_061122-F-1234P-051.jpg
[x29]: https://commons.wikimedia.org/wiki/File:Grumman_X-29_afg-041110-053.jpg
