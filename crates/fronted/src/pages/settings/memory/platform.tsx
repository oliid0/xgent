// UI dependency boundary for the shared memory settings panel. Sibling files
// reach Astryx only through the exports below.

import { Selector } from "@astryxdesign/core/Selector";

export {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Brain,
  BrushCleaning,
  Check,
  ChevronDown,
  Folder,
  Globe2,
  History,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  X,
} from "../../../components/icons";
export { Button } from "../../../components/ui/button";
export { Input } from "../../../components/ui/input";
export { buildModelOptions } from "../../../lib/chat/page/chatPageHelpers";
export { pokeMemoryOrganizer } from "../../../lib/memory/organizer/service";
export { parseModelValue, toModelValue } from "../../../lib/providers/llm";
export { ModelPicker } from "../modelPicker";
export { AgentActivationSwitch } from "../shared";

/** The desktop GUI runs the organizer in-process; Run Now can poke it. */
export const canRunOrganizerLocally = true;

export type DrawerSelectOption = {
  value: string;
  label: string;
  description?: string;
};

export function DrawerSelect(props: {
  value: string;
  onValueChange: (value: string) => void;
  options: DrawerSelectOption[];
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { value, onValueChange, options, ariaLabel, placeholder, disabled, className } = props;
  return (
    <Selector
      label={ariaLabel ?? placeholder ?? "Select an option"}
      isLabelHidden
      value={value}
      onChange={onValueChange}
      options={options}
      isDisabled={disabled}
      placeholder={placeholder}
      className={className}
      width="100%"
    />
  );
}
