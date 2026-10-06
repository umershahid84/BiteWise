import { Select } from '@/components/ui/field';
import { US_STATES } from '@/lib/tax/states';

// US state picker for restaurant addresses (the state decides the sales tax rules).
export function StateSelect(props: React.ComponentProps<typeof Select>) {
  return (
    <Select autoComplete="address-level1" {...props}>
      <option value="">Choose…</option>
      {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
    </Select>
  );
}
