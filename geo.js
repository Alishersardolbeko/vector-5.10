// geo.js — O'zbekiston viloyatlari va shahar/tumanlari, hamda sinflar ro'yxati.
// Ilova va admin panel shu ro'yxatni /api/geo orqali oladi.

const REGIONS = [
  { id: 'toshkent-sh', name: 'Toshkent shahri', districts: [
    'Bektemir tumani', 'Chilonzor tumani', 'Mirobod tumani', "Mirzo Ulug'bek tumani", 'Olmazor tumani', 'Sergeli tumani',
    'Shayxontohur tumani', 'Uchtepa tumani', 'Yakkasaroy tumani', 'Yangihayot tumani', 'Yashnobod tumani', 'Yunusobod tumani'] },
  { id: 'andijon', name: 'Andijon viloyati', districts: [
    'Andijon shahri', 'Xonobod shahri', 'Andijon tumani', 'Asaka tumani', 'Baliqchi tumani', "Bo'ston tumani", 'Buloqboshi tumani',
    'Izboskan tumani', 'Jalaquduq tumani', "Marhamat tumani", "Oltinko'l tumani", 'Paxtaobod tumani', "Qo'rg'ontepa tumani",
    'Shahrixon tumani', "Ulug'nor tumani", "Xo'jaobod tumani"] },
  { id: 'buxoro', name: 'Buxoro viloyati', districts: [
    'Buxoro shahri', 'Kogon shahri', 'Buxoro tumani', "G'ijduvon tumani", 'Jondor tumani', 'Kogon tumani', 'Olot tumani',
    'Peshku tumani', "Qorako'l tumani", 'Qorovulbozor tumani', 'Romitan tumani', 'Shofirkon tumani', 'Vobkent tumani'] },
  { id: 'fargona', name: "Farg'ona viloyati", districts: [
    "Farg'ona shahri", "Marg'ilon shahri", "Qo'qon shahri", 'Quvasoy shahri', "Bag'dod tumani", 'Beshariq tumani', 'Buvayda tumani',
    "Dang'ara tumani", "Farg'ona tumani", 'Furqat tumani', 'Oltiariq tumani', "Qo'shtepa tumani", 'Quva tumani', 'Rishton tumani',
    "So'x tumani", 'Toshloq tumani', "Uchko'prik tumani", "O'zbekiston tumani", 'Yozyovon tumani'] },
  { id: 'jizzax', name: 'Jizzax viloyati', districts: [
    'Jizzax shahri', 'Arnasoy tumani', 'Baxmal tumani', "Do'stlik tumani", 'Forish tumani', "G'allaorol tumani", "Mirzacho'l tumani",
    'Paxtakor tumani', 'Sharof Rashidov tumani', 'Yangiobod tumani', 'Zafarobod tumani', 'Zarbdor tumani', 'Zomin tumani'] },
  { id: 'xorazm', name: 'Xorazm viloyati', districts: [
    'Urganch shahri', 'Xiva shahri', "Bog'ot tumani", 'Gurlan tumani', 'Hazorasp tumani', "Qo'shko'pir tumani", 'Shovot tumani',
    "Tuproqqal'a tumani", 'Urganch tumani', 'Xiva tumani', 'Xonqa tumani', 'Yangiariq tumani', 'Yangibozor tumani'] },
  { id: 'namangan', name: 'Namangan viloyati', districts: [
    'Namangan shahri', 'Chortoq tumani', 'Chust tumani', 'Davlatobod tumani', 'Kosonsoy tumani', 'Mingbuloq tumani', 'Namangan tumani',
    'Norin tumani', 'Pop tumani', "To'raqo'rg'on tumani", "Uchqo'rg'on tumani", 'Uychi tumani', 'Yangi Namangan tumani', "Yangiqo'rg'on tumani"] },
  { id: 'navoiy', name: 'Navoiy viloyati', districts: [
    'Navoiy shahri', 'Zarafshon shahri', "G'ozg'on shahri", 'Karmana tumani', 'Konimex tumani', 'Navbahor tumani', 'Nurota tumani',
    'Qiziltepa tumani', 'Tomdi tumani', 'Uchquduq tumani', 'Xatirchi tumani'] },
  { id: 'qashqadaryo', name: 'Qashqadaryo viloyati', districts: [
    'Qarshi shahri', 'Shahrisabz shahri', 'Chiroqchi tumani', 'Dehqonobod tumani', "G'uzor tumani", 'Kasbi tumani', 'Kitob tumani',
    "Ko'kdala tumani", 'Koson tumani', 'Mirishkor tumani', 'Muborak tumani', 'Nishon tumani', 'Qamashi tumani', 'Qarshi tumani',
    'Shahrisabz tumani', "Yakkabog' tumani"] },
  { id: 'qoraqalpogiston', name: "Qoraqalpog'iston Respublikasi", districts: [
    'Nukus shahri', 'Amudaryo tumani', 'Beruniy tumani', "Bo'zatov tumani", 'Chimboy tumani', "Ellikqal'a tumani", 'Kegeyli tumani',
    "Mo'ynoq tumani", 'Nukus tumani', "Qanliko'l tumani", "Qo'ng'irot tumani", "Qorao'zak tumani", 'Shumanay tumani',
    'Taxiatosh tumani', "Taxtako'pir tumani", "To'rtko'l tumani", "Xo'jayli tumani"] },
  { id: 'samarqand', name: 'Samarqand viloyati', districts: [
    'Samarqand shahri', "Kattaqo'rg'on shahri", "Bulung'ur tumani", 'Ishtixon tumani', 'Jomboy tumani', "Kattaqo'rg'on tumani",
    'Narpay tumani', 'Nurobod tumani', 'Oqdaryo tumani', 'Pastdarg\'om tumani', 'Paxtachi tumani', 'Payariq tumani',
    "Qo'shrabot tumani", 'Samarqand tumani', 'Toyloq tumani', 'Urgut tumani'] },
  { id: 'sirdaryo', name: 'Sirdaryo viloyati', districts: [
    'Guliston shahri', 'Shirin shahri', 'Yangiyer shahri', 'Boyovut tumani', 'Guliston tumani', 'Mirzaobod tumani', 'Oqoltin tumani',
    'Sardoba tumani', 'Sayxunobod tumani', 'Sirdaryo tumani', 'Xovos tumani'] },
  { id: 'surxondaryo', name: 'Surxondaryo viloyati', districts: [
    'Termiz shahri', 'Angor tumani', 'Bandixon tumani', 'Boysun tumani', 'Denov tumani', "Jarqo'rg'on tumani", 'Muzrabot tumani',
    'Oltinsoy tumani', 'Qiziriq tumani', "Qumqo'rg'on tumani", 'Sariosiyo tumani', 'Sherobod tumani', "Sho'rchi tumani",
    'Termiz tumani', 'Uzun tumani'] },
  { id: 'toshkent-v', name: 'Toshkent viloyati', districts: [
    'Nurafshon shahri', 'Olmaliq shahri', 'Angren shahri', 'Bekobod shahri', 'Ohangaron shahri', 'Chirchiq shahri', "Yangiyo'l shahri",
    'Bekobod tumani', "Bo'ka tumani", "Bo'stonliq tumani", 'Chinoz tumani', 'Ohangaron tumani', "Oqqo'rg'on tumani", "O'rta Chirchiq tumani",
    'Parkent tumani', 'Piskent tumani', 'Qibray tumani', 'Quyi Chirchiq tumani', 'Toshkent tumani', "Yangiyo'l tumani",
    'Yuqori Chirchiq tumani', 'Zangiota tumani'] },
];

const GRADES = ['1-sinf', '2-sinf', '3-sinf', '4-sinf', '5-sinf', '6-sinf', '7-sinf', '8-sinf', '9-sinf', '10-sinf', '11-sinf',
  'Maktabni bitirganman', 'Talaba', 'Boshqa'];

function findRegion(id) { return REGIONS.find((r) => r.id === id) || null; }
function validDistrict(regionId, district) {
  const r = findRegion(regionId);
  return Boolean(r && r.districts.includes(district));
}

module.exports = { REGIONS, GRADES, findRegion, validDistrict };
