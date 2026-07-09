---
"@dialogue-foundry/frontend": patch
---

Fix suggestions scrollbar still showing double scrollbars in Chromium browsers: a global `!important` `scrollbar-width: thin` utility applied to every widget descendant was overriding Radix ScrollArea's native-scrollbar-hiding styles now that Chromium supports the standard `scrollbar-width` property
