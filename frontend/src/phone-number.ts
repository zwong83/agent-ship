import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

export type PhoneCountry = CountryCode;

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const phoneCountries = getCountries().map(country => ({
  country,
  name: countryNames.of(country) ?? country,
  code: '+' + getCountryCallingCode(country),
})).sort((a, b) => a.name.localeCompare(b.name, 'en'));

export function internationalPhone(value: string, country: PhoneCountry): string | null {
  const phone = parsePhoneNumberFromString(value.trim(), { defaultCountry: country, extract: false });
  if (!phone || !phone.isPossible() || phone.ext || phone.countryCallingCode !== getCountryCallingCode(country)) return null;
  return phone.number;
}
