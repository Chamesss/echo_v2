import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppearance } from "../appearance-provider";
import { THEMES, type ThemeMeta } from "../themes";
import type { AppearanceMode, ThemeId } from "../schema";

/**
 * The appearance picker — mode, theme, and density.
 *
 * Rendered on the ACCOUNT page, not workspace settings: this is a personal
 * preference that follows the user into every workspace they belong to.
 *
 * Every control writes through `useAppearance().setPreferences`, which applies
 * the change to the DOM immediately and persists it in the background, so the
 * preview is the live app rather than a mockup.
 */
export function AppearanceSection() {
  const { preferences, setPreferences } = useAppearance();

  return (
    <div className="space-y-6">
      <Field
        label="Mode"
        description="Whether the app is light or dark. Themes work with either."
      >
        <div
          role="radiogroup"
          aria-label="Appearance mode"
          className="inline-flex rounded-lg border border-border p-1"
        >
          <ModeOption
            mode="light"
            current={preferences.mode}
            icon={<Sun className="size-4" />}
            label="Light"
            onSelect={setPreferences}
          />
          <ModeOption
            mode="dark"
            current={preferences.mode}
            icon={<Moon className="size-4" />}
            label="Dark"
            onSelect={setPreferences}
          />
          <ModeOption
            mode="system"
            current={preferences.mode}
            icon={<Monitor className="size-4" />}
            label="System"
            onSelect={setPreferences}
          />
        </div>
      </Field>

      <Field
        label="Theme"
        description="Colors the whole app — the sidebar in full, and every other surface with a subtle tint of the same hue."
      >
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        >
          {THEMES.map((theme) => (
            <ThemeOption
              key={theme.id}
              theme={theme}
              selected={preferences.theme === theme.id}
              onSelect={(id) => setPreferences({ theme: id })}
            />
          ))}
        </div>
      </Field>

      <Field
        label="Density"
        description="Compact fits more messages on screen."
      >
        <div
          role="radiogroup"
          aria-label="Density"
          className="inline-flex rounded-lg border border-border p-1"
        >
          {(["comfortable", "compact"] as const).map((density) => (
            <button
              key={density}
              type="button"
              role="radio"
              aria-checked={preferences.density === density}
              onClick={() => setPreferences({ density })}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                preferences.density === density
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {density}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function ModeOption({
  mode,
  current,
  icon,
  label,
  onSelect,
}: {
  mode: AppearanceMode;
  current: AppearanceMode;
  icon: React.ReactNode;
  label: string;
  onSelect: (patch: { mode: AppearanceMode }) => void;
}) {
  const selected = current === mode;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect({ mode })}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        selected
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * A theme swatch drawn as a miniature sidebar: the column color, an "active"
 * row, and two text bars. Colors come from the registry's `swatch` metadata
 * rather than computed styles, so a card can preview a theme that isn't
 * currently applied.
 */
function ThemeOption({
  theme,
  selected,
  onSelect,
}: {
  theme: ThemeMeta;
  selected: boolean;
  onSelect: (id: ThemeId) => void;
}) {
  const [sidebar, active, foreground, mutedForeground] = theme.swatch;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={theme.label}
      title={theme.description}
      onClick={() => onSelect(theme.id)}
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border text-left transition-all",
        selected
          ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background"
          : "border-border hover:border-foreground/30",
      )}
    >
      <div
        className="relative flex h-20 flex-col justify-center gap-1.5 p-2.5"
        style={{ backgroundColor: sidebar }}
        aria-hidden="true"
      >
        <div
          className="h-2 w-3/4 rounded-full"
          style={{ backgroundColor: active }}
        />
        <div
          className="h-1.5 w-1/2 rounded-full"
          style={{ backgroundColor: foreground }}
        />
        <div
          className="h-1.5 w-2/3 rounded-full"
          style={{ backgroundColor: mutedForeground }}
        />
        {selected && (
          <span
            className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full"
            style={{ backgroundColor: active, color: sidebar }}
          >
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="border-t border-border bg-card px-2.5 py-2">
        <div className="truncate text-sm font-medium text-foreground">
          {theme.label}
        </div>
      </div>
    </button>
  );
}
