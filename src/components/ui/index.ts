/* The Sona design system. One import site for every shared primitive:
 *
 *   import { Button, Card, EmptyState } from "@/components/ui";
 *
 * Rules the primitives keep, so pages do not have to restate them:
 *   - every control has default, hover, active, focus-visible and disabled;
 *   - focus is the global accent ring from styles/base.css, never removed;
 *   - surfaces are flat with a 1px hairline, shadows only on things that
 *     float, and a card never contains another card;
 *   - color comes from styles/theme.css tokens, never raw hex;
 *   - state reads as text, never as a colored dot alone.
 */

export { Alert } from "./Alert";
export type { AlertProps, AlertVariant } from "./Alert";

export { AudioPlayer, AudioPlayerGroup } from "./AudioPlayer";
export type { AudioPlayerProps } from "./AudioPlayer";

export { default as Badge } from "./Badge";
export type { BadgeProps } from "./Badge";

export { Button, IconButton } from "./Button";
export type {
  ButtonProps,
  ButtonSize,
  ButtonVariant,
  IconButtonProps,
} from "./Button";

export { Card, Section } from "./Card";
export type { CardPadding, CardProps, CardTone, SectionProps } from "./Card";

export { Dialog } from "./Dialog";
export type { DialogProps } from "./Dialog";

export { Dropdown } from "./Dropdown";
export type { DropdownOption, DropdownProps } from "./Dropdown";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps, EmptyStateVariant } from "./EmptyState";

export { GridConnector } from "./GridConnector";
export type { GridConnectorProps } from "./GridConnector";

export { Input } from "./Input";
export type { InputProps } from "./Input";

export { Kbd, KbdChord } from "./Kbd";
export type { KbdChordProps, KbdProps } from "./Kbd";

export { List, Row } from "./List";
export type { ListProps, RowProps } from "./List";

export { PathDisplay } from "./PathDisplay";
export type { PathDisplayProps } from "./PathDisplay";

export { ResetButton } from "./ResetButton";
export type { ResetButtonProps } from "./ResetButton";

export { Select } from "./Select";
export type { SelectOption, SelectProps } from "./Select";

export { SettingContainer } from "./SettingContainer";
export type { SettingContainerProps } from "./SettingContainer";

export { ShaderHero } from "./ShaderHero";
export type { ShaderHeroProps } from "./ShaderHero";

export { SettingsGroup } from "./SettingsGroup";
export type { SettingsGroupProps } from "./SettingsGroup";

export { RouteSkeleton, Skeleton } from "./Skeleton";
export type { RouteSkeletonProps, SkeletonProps } from "./Skeleton";

export { Slider } from "./Slider";
export type { SliderProps } from "./Slider";

export { StatusText } from "./StatusText";
export type { StatusTextProps, StatusTone } from "./StatusText";

export { Switch } from "./Switch";
export type { SwitchProps } from "./Switch";

export { Tabs } from "./Tabs";
export type { TabItem, TabsProps } from "./Tabs";

export { Textarea } from "./Textarea";
export type { TextareaProps } from "./Textarea";

export { Toaster } from "./Toast";

export { ToggleSwitch } from "./ToggleSwitch";
export type { ToggleSwitchProps } from "./ToggleSwitch";

export { default as ProgressBar } from "../shared/ProgressBar";
export type { ProgressData } from "../shared/ProgressBar";
