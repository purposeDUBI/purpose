# Purpose Contracts

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
