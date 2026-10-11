import { Select } from '@/components/ui/field';
import { COUNTRIES, regionsOf, type Country } from '@/lib/regions';

// State (United States) or province / territory (Canada) picker: with the country, it decides the sales tax rules
// and which terms apply.
export function StateSelect({ country = 'US', ...props }: React.ComponentProps<typeof Select> & { country?: Country }) {
  return (
    <Select autoComplete="address-level1" {...props}>
      <option value="">Choose…</option>
      {regionsOf(country).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
    </Select>
  );
}

// United States or Canada.
export function CountrySelect(props: React.ComponentProps<typeof Select>) {
  return (
    <Select autoComplete="country" {...props}>
      {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
    </Select>
  );
}
