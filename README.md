# Purpose Contracts

Mainnet addresses

```json
{
    "Purpose": "0xb628Bc994e39CE264ECa6f6EE1620909816A9F12",
    "Dubi": "0xF3D6Af45C6dFeC43216CC3347Ea91fEfBa0849D1",
    "Hodl": "0xaC0122e9258a85bA5479DB764DC8eF91caB08db0"
}
```

## Install

`npm i`

## Compile

`npm run compile`

## Run tests

Run specific tests
`npm run test tests/purpose.test.ts`

Or all
`npm run test tests/**.test.ts`

But be aware that the hodl tests don't like to be run in sequence, because they increase the time on the ganache chain which will eventually
cause an overflow when it's past year 2038. The minted DUBI asserts then fail because the numbers no longer make any sense.

Lastly, the forked OpenZeppelin ERC20 tests:

`npm run test-openzeppelin-fork`
