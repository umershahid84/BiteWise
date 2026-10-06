'use client';

import { useState } from 'react';
import { formatPhoneInput } from '@/lib/phone';
import { Input } from './field';

// A phone number field that formats as you type: (206) 555-0123. Works controlled (value + onValueChange) or with a
// form (name + defaultValue).
export function PhoneInput({ value, defaultValue, onValueChange, ...props }: Omit<React.ComponentProps<'input'>, 'value' | 'defaultValue' | 'onChange'> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}) {
  const [own, setOwn] = useState(() => formatPhoneInput(defaultValue ?? ''));
  const shown = value !== undefined ? formatPhoneInput(value) : own;
  return (
    <Input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="(206) 555-0123"
      maxLength={14}
      {...props}
      value={shown}
      onChange={(e) => {
        const next = formatPhoneInput(e.target.value);
        if (value === undefined) setOwn(next);
        onValueChange?.(next);
      }}
    />
  );
}
