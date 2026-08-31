import React from "react";
import { useTranslation } from "react-i18next";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/vg/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/vg/dialog";
import { Kbd } from "@/components/vg/kbd";
import {
  groupPaletteActions,
  type CommandPaletteAction,
} from "./commandPaletteActions";

/* The command palette: cmdk inside the shared dialog, and nothing else.
 *
 * It is mounted eagerly with the shell. The previous version lazy-loaded this
 * surface behind `<Suspense fallback={null}>` and latched a second `summoned`
 * flag beside the parent's `open`, which meant the first chord painted nothing
 * at all until the chunk landed and then started an entrance spring from
 * opacity 0 — press, blank, appear. That gap is what made people press the
 * chord again, and the second press toggled it shut. Neither the chunk nor the
 * latch is worth a flicker on the app's primary navigation surface.
 *
 * Motion is gone from this path too: cmdk owns the highlight and the
 * scroll-into-view, Radix owns focus and dismissal, and the only animation is
 * the dialog's own 150ms fade and scale. The global reduced-motion rule in
 * App.css collapses that for anyone who asked.
 *
 * `Dialog` + `Command` rather than the kit's `CommandDialog` wrapper lets this
 * surface apply the shared sentence-case group-label role directly. */

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: readonly CommandPaletteAction[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onOpenChange,
  actions,
}) => {
  const { t } = useTranslation();
  const sections = groupPaletteActions(actions);
  const groupLabels = {
    navigation: t("commandPalette.navigation"),
    actions: t("commandPalette.actions"),
  } satisfies Record<CommandPaletteAction["group"], string>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        /* Sits high rather than centred — a palette is read against the top of
           the window, not its middle — so the kit's vertical centring is
           replaced outright instead of offset. `glass-surface` is inert until
           the Material setting is Glass and native vibrancy actually applied;
           see styles/primitives.css. */
        className="glass-surface top-[max(12vh,64px)] translate-y-0 gap-0 overflow-hidden border border-gray-alpha-400 bg-background-100 p-0 duration-150 sm:max-w-[560px]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("commandPalette.open")}</DialogTitle>
          <DialogDescription>
            {t("commandPalette.placeholder")}
          </DialogDescription>
        </DialogHeader>
        {/* The input row's own divider is this field's focus indicator: it steps
            to the next border colour while the field holds focus. A ring around
            the only focusable element inside an already-modal palette is noise,
            so the app's default focus outline is suppressed here and the
            divider is the replacement indicator base.css asks any suppressor to
            draw. */}
        <Command
          loop
          className="bg-transparent **:data-[slot=command-input-wrapper]:h-12 **:data-[slot=command-input-wrapper]:border-gray-alpha-400 **:data-[slot=command-input-wrapper]:px-4 **:data-[slot=command-input-wrapper]:focus-within:border-gray-alpha-600"
        >
          <div className="relative">
            <CommandInput
              placeholder={t("commandPalette.placeholder")}
              className="pe-14 text-[14px] leading-[20px] text-gray-1000 placeholder:text-gray-800 focus-visible:outline-none"
            />
            {/* The one hint the palette carries. The chord that opens it is
                taught by the sidebar row; repeating it here would be the
                second copy of the same datum on one screen. */}
            <Kbd className="absolute end-4 top-1/2 -translate-y-1/2">
              {t("commandPalette.esc")}
            </Kbd>
          </div>
          {/* Sized so the whole registry fits. The 340px this inherited from
              the old stylesheet is 29px short of the ten rows and two headings
              the palette actually has, so it always scrolled and always cut a
              row in half — the old build merely hid the seam behind its
              footer. A palette that truncates its own contents on first open
              is a broken interaction, not a tight one. */}
          <CommandList className="max-h-[min(60vh,440px)]">
            <CommandEmpty className="py-10 text-center text-[13px] text-gray-900">
              {t("commandPalette.noResults")}
            </CommandEmpty>
            {sections.map((section) => (
              <CommandGroup
                key={section.group}
                heading={groupLabels[section.group]}
                className="p-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[13px] [&_[cmdk-group-heading]]:leading-5 [&_[cmdk-group-heading]]:text-gray-900"
              >
                {section.items.map((action) => {
                  const ActionIcon = action.icon;
                  return (
                    <CommandItem
                      key={action.id}
                      value={action.label}
                      onSelect={() => {
                        /* Closed first, then run: a navigating action goes
                           through a view transition whose `flushSync` also
                           flushes this close, so the palette leaves inside the
                           same cross-fade as the route instead of lingering for
                           a frame on the far side of it. */
                        onOpenChange(false);
                        action.run();
                      }}
                      /* Rows are the content of this surface, so they take the
                         content tier. Shipping them at gray-900 was the mistake:
                         measured against the palette's own #0a0a0a it is 7.66:1
                         where gray-1000 is 16.91:1, so every row you came here
                         to read was at less than half the contrast the surface
                         it replaced gave them. gray-900 is for prose; a row you
                         are scanning to pick is not prose. The muted tiers stay
                         where they belong — group headings and the icons. */
                      className="min-h-9 gap-2.5 rounded-md px-2 py-2 text-[13px] text-gray-1000 data-[selected=true]:bg-gray-alpha-300"
                    >
                      <ActionIcon aria-hidden="true" className="size-4" />
                      <span className="min-w-0 truncate">{action.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
};
