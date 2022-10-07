# Purpose Contracts

## Mainnet addresses

| Contract | Address |
| --------------- | --------------- |  
| PRPS | [0x972999c58BbcE63a2e398d4ED3Bde414b8349eB3](https://polygonscan.com/address/0x972999c58bbce63a2e398d4ed3bde414b8349eb3) |  
| DUBI | [0x950e1561B7A7dEB1A32A6419FD435410daf851B0](https://polygonscan.com/address/0x950e1561b7a7deb1a32a6419fd435410daf851b0) |  
| HODL | [0x0ff652F7E5389EF66cB0c1Add614F5a50d1e2E34](https://polygonscan.com/address/0x0ff652F7E5389EF66cB0c1Add614F5a50d1e2E34) |  

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
