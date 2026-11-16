import { phoneCountries, type PhoneCountry } from './phone-number';
import { Field } from './ui';
import { Select } from './select';

export function PhoneCountryPicker({ value, onChange }: { value: PhoneCountry; onChange: (country: PhoneCountry) => void }) {
  return <div className="country-picker"><Field label="Country code"><Select name="phoneCountry" value={value}
    onChange={event => onChange(event.target.value as PhoneCountry)}>
    {phoneCountries.map(country => <option key={country.country} value={country.country}>{country.name} ({country.code}) · {country.country}</option>)}
  </Select></Field></div>;
}
