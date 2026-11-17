/**
 * Spanish country names (neutral Latin American usage), loaded only when the
 * interface is Spanish (see countryNames.ts). One row per row of the
 * `countries` table: code | English name | English demonym | Spanish name.
 * The English columns are the keys: the database stores and filters by them,
 * so they must match `countries.name` and `countries.nationality_name`.
 * Added 2026-11-17; a new country in the table needs a row here
 * (countryNames.test.ts lists what the table held that day).
 */
export const COUNTRY_ROWS = `
AD|Andorra|Andorran|Andorra
AE|United Arab Emirates|Emirati|Emiratos Árabes Unidos
AF|Afghanistan|Afghan|Afganistán
AG|Antigua and Barbuda|Antiguan|Antigua y Barbuda
AL|Albania|Albanian|Albania
AM|Armenia|Armenian|Armenia
AO|Angola|Angolan|Angola
AR|Argentina|Argentine|Argentina
AT|Austria|Austrian|Austria
AU|Australia|Australian|Australia
AZ|Azerbaijan|Azerbaijani|Azerbaiyán
BA|Bosnia and Herzegovina|Bosnian|Bosnia y Herzegovina
BB|Barbados|Barbadian|Barbados
BD|Bangladesh|Bangladeshi|Bangladesh
BE|Belgium|Belgian|Bélgica
BF|Burkina Faso|Burkinabé|Burkina Faso
BG|Bulgaria|Bulgarian|Bulgaria
BH|Bahrain|Bahraini|Baréin
BI|Burundi|Burundian|Burundi
BJ|Benin|Beninese|Benín
BN|Brunei|Bruneian|Brunéi
BO|Bolivia|Bolivian|Bolivia
BR|Brazil|Brazilian|Brasil
BS|Bahamas|Bahamian|Bahamas
BT|Bhutan|Bhutanese|Bután
BW|Botswana|Motswana|Botsuana
BY|Belarus|Belarusian|Bielorrusia
BZ|Belize|Belizean|Belice
CA|Canada|Canadian|Canadá
CD|Democratic Republic of the Congo|Congolese|República Democrática del Congo
CF|Central African Republic|Central African|República Centroafricana
CG|Congo|Congolese|Congo
CH|Switzerland|Swiss|Suiza
CI|Ivory Coast|Ivorian|Costa de Marfil
CL|Chile|Chilean|Chile
CM|Cameroon|Cameroonian|Camerún
CN|China|Chinese|China
CO|Colombia|Colombian|Colombia
CR|Costa Rica|Costa Rican|Costa Rica
CU|Cuba|Cuban|Cuba
CV|Cabo Verde|Cape Verdean|Cabo Verde
CY|Cyprus|Cypriot|Chipre
CZ|Czech Republic|Czech|República Checa
DE|Germany|German|Alemania
DJ|Djibouti|Djiboutian|Yibuti
DK|Denmark|Danish|Dinamarca
DM|Dominica|Dominican|Dominica
DO|Dominican Republic|Dominican|República Dominicana
DZ|Algeria|Algerian|Argelia
EC|Ecuador|Ecuadorian|Ecuador
EE|Estonia|Estonian|Estonia
EG|Egypt|Egyptian|Egipto
ER|Eritrea|Eritrean|Eritrea
ES|Spain|Spanish|España
ET|Ethiopia|Ethiopian|Etiopía
FI|Finland|Finnish|Finlandia
FJ|Fiji|Fijian|Fiyi
FM|Micronesia|Micronesian|Micronesia
FR|France|French|Francia
GA|Gabon|Gabonese|Gabón
GB|United Kingdom|British|Reino Unido
GB-ENG|England|English|Inglaterra
GB-NIR|Northern Ireland|Northern Irish|Irlanda del Norte
GB-SCT|Scotland|Scottish|Escocia
GB-WLS|Wales|Welsh|Gales
GD|Grenada|Grenadian|Granada
GE|Georgia|Georgian|Georgia
GH|Ghana|Ghanaian|Ghana
GM|Gambia|Gambian|Gambia
GN|Guinea|Guinean|Guinea
GQ|Equatorial Guinea|Equatoguinean|Guinea Ecuatorial
GR|Greece|Greek|Grecia
GT|Guatemala|Guatemalan|Guatemala
GW|Guinea-Bissau|Bissau-Guinean|Guinea-Bisáu
GY|Guyana|Guyanese|Guyana
HN|Honduras|Honduran|Honduras
HR|Croatia|Croatian|Croacia
HT|Haiti|Haitian|Haití
HU|Hungary|Hungarian|Hungría
ID|Indonesia|Indonesian|Indonesia
IE|Ireland|Irish|Irlanda
IL|Israel|Israeli|Israel
IN|India|Indian|India
IQ|Iraq|Iraqi|Irak
IR|Iran|Iranian|Irán
IS|Iceland|Icelandic|Islandia
IT|Italy|Italian|Italia
JM|Jamaica|Jamaican|Jamaica
JO|Jordan|Jordanian|Jordania
JP|Japan|Japanese|Japón
KE|Kenya|Kenyan|Kenia
KG|Kyrgyzstan|Kyrgyz|Kirguistán
KH|Cambodia|Cambodian|Camboya
KI|Kiribati|I-Kiribati|Kiribati
KM|Comoros|Comorian|Comoras
KN|Saint Kitts and Nevis|Kittitian|San Cristóbal y Nieves
KP|North Korea|North Korean|Corea del Norte
KR|South Korea|South Korean|Corea del Sur
KW|Kuwait|Kuwaiti|Kuwait
KZ|Kazakhstan|Kazakhstani|Kazajistán
LA|Laos|Lao|Laos
LB|Lebanon|Lebanese|Líbano
LC|Saint Lucia|Saint Lucian|Santa Lucía
LI|Liechtenstein|Liechtensteiner|Liechtenstein
LK|Sri Lanka|Sri Lankan|Sri Lanka
LR|Liberia|Liberian|Liberia
LS|Lesotho|Mosotho|Lesoto
LT|Lithuania|Lithuanian|Lituania
LU|Luxembourg|Luxembourgish|Luxemburgo
LV|Latvia|Latvian|Letonia
LY|Libya|Libyan|Libia
MA|Morocco|Moroccan|Marruecos
MC|Monaco|Monegasque|Mónaco
MD|Moldova|Moldovan|Moldavia
ME|Montenegro|Montenegrin|Montenegro
MG|Madagascar|Malagasy|Madagascar
MH|Marshall Islands|Marshallese|Islas Marshall
MK|North Macedonia|Macedonian|Macedonia del Norte
ML|Mali|Malian|Malí
MM|Myanmar|Burmese|Myanmar
MN|Mongolia|Mongolian|Mongolia
MR|Mauritania|Mauritanian|Mauritania
MT|Malta|Maltese|Malta
MU|Mauritius|Mauritian|Mauricio
MV|Maldives|Maldivian|Maldivas
MW|Malawi|Malawian|Malaui
MX|Mexico|Mexican|México
MY|Malaysia|Malaysian|Malasia
MZ|Mozambique|Mozambican|Mozambique
NA|Namibia|Namibian|Namibia
NE|Niger|Nigerien|Níger
NG|Nigeria|Nigerian|Nigeria
NI|Nicaragua|Nicaraguan|Nicaragua
NL|Netherlands|Dutch|Países Bajos
NO|Norway|Norwegian|Noruega
NP|Nepal|Nepali|Nepal
NR|Nauru|Nauruan|Nauru
NZ|New Zealand|New Zealander|Nueva Zelanda
OM|Oman|Omani|Omán
PA|Panama|Panamanian|Panamá
PE|Peru|Peruvian|Perú
PG|Papua New Guinea|Papua New Guinean|Papúa Nueva Guinea
PH|Philippines|Filipino|Filipinas
PK|Pakistan|Pakistani|Pakistán
PL|Poland|Polish|Polonia
PR|Puerto Rico|Puerto Rican|Puerto Rico
PS|Palestine|Palestinian|Palestina
PT|Portugal|Portuguese|Portugal
PW|Palau|Palauan|Palaos
PY|Paraguay|Paraguayan|Paraguay
QA|Qatar|Qatari|Catar
RO|Romania|Romanian|Rumania
RS|Serbia|Serbian|Serbia
RU|Russia|Russian|Rusia
RW|Rwanda|Rwandan|Ruanda
SA|Saudi Arabia|Saudi|Arabia Saudita
SB|Solomon Islands|Solomon Islander|Islas Salomón
SC|Seychelles|Seychellois|Seychelles
SD|Sudan|Sudanese|Sudán
SE|Sweden|Swedish|Suecia
SG|Singapore|Singaporean|Singapur
SI|Slovenia|Slovenian|Eslovenia
SK|Slovakia|Slovak|Eslovaquia
SL|Sierra Leone|Sierra Leonean|Sierra Leona
SM|San Marino|Sammarinese|San Marino
SN|Senegal|Senegalese|Senegal
SO|Somalia|Somali|Somalia
SR|Suriname|Surinamese|Surinam
SS|South Sudan|South Sudanese|Sudán del Sur
ST|Sao Tome and Principe|São Toméan|Santo Tomé y Príncipe
SV|El Salvador|Salvadoran|El Salvador
SY|Syria|Syrian|Siria
SZ|Eswatini|Swazi|Esuatini
TD|Chad|Chadian|Chad
TG|Togo|Togolese|Togo
TH|Thailand|Thai|Tailandia
TJ|Tajikistan|Tajik|Tayikistán
TL|Timor-Leste|Timorese|Timor Oriental
TM|Turkmenistan|Turkmen|Turkmenistán
TN|Tunisia|Tunisian|Túnez
TO|Tonga|Tongan|Tonga
TR|Turkey|Turkish|Turquía
TT|Trinidad and Tobago|Trinidadian|Trinidad y Tobago
TV|Tuvalu|Tuvaluan|Tuvalu
TW|Taiwan|Taiwanese|Taiwán
TZ|Tanzania|Tanzanian|Tanzania
UA|Ukraine|Ukrainian|Ucrania
UG|Uganda|Ugandan|Uganda
US|United States|American|Estados Unidos
UY|Uruguay|Uruguayan|Uruguay
UZ|Uzbekistan|Uzbek|Uzbekistán
VA|Vatican City|Vatican|Ciudad del Vaticano
VC|Saint Vincent and the Grenadines|Vincentian|San Vicente y las Granadinas
VE|Venezuela|Venezuelan|Venezuela
VN|Vietnam|Vietnamese|Vietnam
VU|Vanuatu|Ni-Vanuatu|Vanuatu
WS|Samoa|Samoan|Samoa
XK|Kosovo|Kosovar|Kosovo
YE|Yemen|Yemeni|Yemen
ZA|South Africa|South African|Sudáfrica
ZM|Zambia|Zambian|Zambia
ZW|Zimbabwe|Zimbabwean|Zimbabue
`

/**
 * Other English spellings that reach the screen as stored text (a place
 * picked from Google, an older profile): alias | English name in the table.
 */
export const COUNTRY_ALIASES = `
USA|United States
United States of America|United States
UK|United Kingdom
Great Britain|United Kingdom
The Netherlands|Netherlands
Holland|Netherlands
Czechia|Czech Republic
Türkiye|Turkey
Turkiye|Turkey
Côte d'Ivoire|Ivory Coast
Cote d'Ivoire|Ivory Coast
Cape Verde|Cabo Verde
East Timor|Timor-Leste
Swaziland|Eswatini
Burma|Myanmar
Republic of Ireland|Ireland
Korea|South Korea
Republic of Korea|South Korea
UAE|United Arab Emirates
DR Congo|Democratic Republic of the Congo
Republic of the Congo|Congo
São Tomé and Príncipe|Sao Tome and Principe
Macedonia|North Macedonia
Russian Federation|Russia
Viet Nam|Vietnam
`
