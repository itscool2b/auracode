# Product reference audit

Reviewed 2026-10-26 against the original handoff and the owner's correction. The product is dark
only. Earlier light studies are historical. The actual reference images were inspected through
Mobbin, alongside the selected Orbit Design Lab screens, before replacing the old application frame.

| Reference | Observed structure | Application |
| --- | --- | --- |
| [Grok conversation](https://mobbin.com/screens/b851f7ba-c1ad-47bf-95f5-ce96559cd10c) | Narrow navigation, quiet header actions, centered prose, one rounded composer with controls along its lower edge | Chat frame, transcript and composer |
| [SpaceXAI Grok Bot](https://mobbin.com/sites/sections/dfea7d6f-670a-4d55-8289-ff0267c89efb) | Sparse navigation and a large contained product viewport | Product presentation and website hierarchy |
| [Harvey product panels](https://mobbin.com/sites/sections/889f579b-4c96-4cf5-b8f5-411f4e7ac478) | Narrow navigation, restrained project headers, clear tables and tabs, solid work surfaces | Project tray and auxiliary panels |
| [Aside product hero](https://mobbin.com/sites/sections/bdad14df-7d77-4d9d-8c30-dfd826d134d1) | Compact project navigation, centered empty state, composer with an independent control row | Empty chat and autonomy controls |
| [X Money account](https://mobbin.com/screens/af77fad2-56b6-47ce-8f8d-a03c93c80315) | Small subdued labels, strong numbers, compact actions, restrained activity sections | Usage, receipts and confirmation hierarchy |
| [X Money send](https://mobbin.com/screens/7a1d8e7b-e9da-4f30-9c66-a14eaabf0498) | Simple search and list rows, secondary metadata, clear separators | Search and selection menus |

Broad searches also returned unrelated payment, writing and subscription screens. Those were
excluded. Marketing typography and decorative backgrounds do not override the approved Geist,
solid surfaces, semantic color and Orbit marks.

## Implementation status

The real desktop now uses compact navigation with Needs you, project disclosure rows and an agent
dock; a title-led header with session controls in a disclosure; and a single composer with agent,
model and autonomy controls. Pending permissions replace the composer while preserving its draft.
Production theme selection is removed. The reference fixture has been visually inspected in dark.

Project management, the three-column handoff picker, Changes panel, onboarding, settings and website
are implemented. Their focused browser gates exercise production components with synthetic native
responses and include accessibility and responsive checks. Local import, export, project terminals,
Git initialization and interrupted profile recovery now use the same dark modal language. Account
lifecycle and portable folder resolution are still being completed. Final integrated visuals and
native Windows/macOS acceptance remain pending; the browser fixtures do not establish native parity.
