/** @type {import('tailwindcss').Config} */
export default { content: ['./index.html', './src/**/*.{ts,tsx}'], theme: { extend: { fontFamily: { sans: ['DM Sans', 'sans-serif'], display: ['Manrope', 'sans-serif'] }, colors: { ink: '#13292a', pine: '#205c57', mint: '#e5f2ed', cream: '#f8f7f2', line: '#e2e8e3' }, boxShadow: { card: '0 14px 40px rgba(19,41,42,.06)' } } }, plugins: [] }
