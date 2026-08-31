import React from "react";
import { useCommandState } from "cmdk";
import { MessageSquare, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { type QueryRow } from "@/bindings";
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
import { formatRelativeTime } from "@/lib/utils/format";
import {
  groupPaletteActions,
  type CommandPaletteAction,
} from "./commandPaletteActions";
import {
  askSona,
  ASK_VALUE,
  canAsk,
  groupQueryRows,
  openRow,
  paletteFilter,
  resultHeadingKeys,
  resultIcons,
  rowValue,
  searchCorpus,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN_CHARS,
} from "./commandPaletteSearch";

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
 * surface apply the shared sentence-case group-label role directly.
 *
 * Typing is now a search of the corpus, not only a filter of this list: two
 * characters in, the query plane answers with meetings, people, dictations and
 * open loops, and Enter on one of them opens its `sona://` address through the
 * same dispatch an external deep link takes. An empty field is exactly the list
 * it always was.
 *
 * Two orderings meet here, so both are named. Inside a section the plane's page
 * order survives untouched (newest first). Between sections cmdk sorts by best
 * score, and `paletteFilter` scores every plane row 1 — the ceiling — so a
 * typed question puts the corpus above the command list, an exactly-matching
 * command ties and stays above it, and the ask row, alone in the last section,
 * can be tied but never beaten. */

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: readonly CommandPaletteAction[];
  /**
   * A question the shell was asked to search for — `sona://search?q=…` arriving
   * while the app is running. The nonce is what makes the same question twice a
   * second request rather than a no-op.
   */
  seed: { query: string; nonce: number } | null;
  /**
   * The agent panel's two standing facts, which is what the ask row is gated
   * on: the toggle in Settings and whether this machine is paired to a relay.
   */
  panel: { enabled: boolean; paired: boolean };
}

interface ResultRowProps {
  row: QueryRow;
  icon: LucideIcon;
  now: number;
  onSelect: () => void;
}

/**
 * One noun from the corpus: what it is, what it is called, the words that
 * matched, and when.
 *
 * Two lines rather than one because a title without its matched text is a
 * search result you have to open to evaluate. The time is the only number on
 * the row, so it sits at the end where the eye can skip it.
 */
const ResultRow: React.FC<ResultRowProps> = ({
  row,
  icon: RowIcon,
  now,
  onSelect,
}) => (
  <CommandItem
    value={rowValue(row)}
    onSelect={onSelect}
    className="min-h-9 items-start gap-2.5 rounded-md px-2 py-2 text-[13px] text-gray-1000 data-[selected=true]:bg-gray-alpha-300"
  >
    <RowIcon aria-hidden="true" className="mt-0.5 size-4" />
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate">{row.title}</span>
      {row.snippet !== "" && (
        <span className="truncate text-[11px] text-gray-900">
          {row.snippet}
        </span>
      )}
    </span>
    <span className="flex-none pt-0.5 text-[11px] text-gray-800 tabular-nums">
      {formatRelativeTime(row.when_utc_ms, now)}
    </span>
  </CommandItem>
);

/**
 * The one sentence a failed search is allowed.
 *
 * It renders only while the list has rows of its own: with an empty list the
 * empty state already carries it, and the panel's rule holds here too — a datum
 * appears once per screen.
 */
const SearchNotice: React.FC<{ message: string }> = ({ message }) => {
  const count = useCommandState((state) => state.filtered.count);
  if (count === 0) return null;
  return (
    <p className="px-3.5 pt-1 pb-3 text-[11px] text-gray-800" role="status">
      {message}
    </p>
  );
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onOpenChange,
  actions,
  seed,
  panel,
}) => {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = React.useState("");
  const [rows, setRows] = React.useState<readonly QueryRow[]>([]);
  const [failed, setFailed] = React.useState(false);
  /* cmdk re-selects the first row on every keystroke, but a page that arrives
   * 150ms later is not a keystroke: without owning the selection, the highlight
   * would stay on whichever command was matched while the corpus answered, and
   * Enter would run it instead of opening the row the reader is looking at. */
  const [selected, setSelected] = React.useState("");
  const requestRef = React.useRef(0);
  /* Read once per render and handed down, so every row on one paint measures
   * "2 minutes ago" from the same instant. A palette is open for seconds; a
   * clock of its own would be a ticking timer nobody reads. */
  const now = Date.now();

  const sections = groupPaletteActions(actions);
  const groupLabels = {
    navigation: t("commandPalette.navigation"),
    actions: t("commandPalette.actions"),
  } satisfies Record<CommandPaletteAction["group"], string>;
  const results = groupQueryRows(rows);
  const asking = canAsk(query, panel);

  React.useEffect(() => {
    if (seed === null) return;
    setQuery(seed.query);
  }, [seed]);

  /* Closing clears the field. A palette that reopens holding last week's
   * question would also reopen holding last week's answers. */
  React.useEffect(() => {
    if (open) return;
    setQuery("");
    setRows([]);
    setFailed(false);
  }, [open]);

  React.useEffect(() => {
    const question = query.trim();
    const request = requestRef.current + 1;
    requestRef.current = request;
    if (question.length < SEARCH_MIN_CHARS) {
      setRows([]);
      setFailed(false);
      return;
    }
    const timer = setTimeout(() => {
      void searchCorpus(question).then((outcome) => {
        // A page that lost its race is a page for a query nobody is reading.
        if (requestRef.current !== request) return;
        setRows(outcome.status === "rows" ? outcome.rows : []);
        setFailed(outcome.status === "failed");
        if (outcome.status === "rows" && outcome.rows.length > 0) {
          setSelected(rowValue(outcome.rows[0]));
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const choose = (row: QueryRow) => {
    /* Closed first, then routed, for the same reason an action is: the close
     * rides inside the same frame as whatever the address navigates to. */
    onOpenChange(false);
    void openRow(row);
  };

  const ask = () => {
    const question = query.trim();
    onOpenChange(false);
    void askSona(question, i18n.language).then((outcome) => {
      if (outcome === "failed") toast.error(t("agentPanel.ask.error"));
    });
  };

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
          filter={paletteFilter}
          value={selected}
          onValueChange={setSelected}
          className="bg-transparent **:data-[slot=command-input-wrapper]:h-12 **:data-[slot=command-input-wrapper]:border-gray-alpha-400 **:data-[slot=command-input-wrapper]:px-4 **:data-[slot=command-input-wrapper]:focus-within:border-gray-alpha-600"
        >
          <div className="relative">
            <CommandInput
              value={query}
              onValueChange={setQuery}
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
              {failed
                ? t("commandPalette.search.unavailable")
                : t("commandPalette.noResults")}
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
            {results.map((section) => (
              <CommandGroup
                key={section.kind}
                heading={t(resultHeadingKeys[section.kind])}
                className="p-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[13px] [&_[cmdk-group-heading]]:leading-5 [&_[cmdk-group-heading]]:text-gray-900"
              >
                {section.rows.map((row) => (
                  <ResultRow
                    key={row.link}
                    row={row}
                    icon={resultIcons[section.kind]}
                    now={now}
                    onSelect={() => choose(row)}
                  />
                ))}
              </CommandGroup>
            ))}
            {failed && (
              <SearchNotice message={t("commandPalette.search.unavailable")} />
            )}
            {asking && (
              <CommandGroup className="p-1.5">
                <CommandItem
                  value={ASK_VALUE}
                  onSelect={ask}
                  className="min-h-9 gap-2.5 rounded-md px-2 py-2 text-[13px] text-gray-1000 data-[selected=true]:bg-gray-alpha-300"
                >
                  <MessageSquare aria-hidden="true" className="size-4" />
                  <span className="min-w-0 truncate">
                    {t("agentPanel.ask.row", { query: query.trim() })}
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
};
