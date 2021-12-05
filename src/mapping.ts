import {Address, BigInt, log} from "@graphprotocol/graph-ts";

import {
    AddPoolEvent, ForceWithdrawEvent,
    HarvestEvent, RACAstake,
    StakeEvent,
} from "../generated/RACAStake/RACAstake";
import {StakePool, StakePoolCount, UserStakeHistories, UserStakeHistory} from "../generated/schema";

enum RemoveType {
    ForceWithdraw,
    Havest,
}

function userStakeHistoryID(contract: string, user: string, beginTime: BigInt): string {
    return `${contract}-${user}-${beginTime}`;
}

function userStakeHistoriesID(contract: string, user: string, poolIndex: BigInt): string {
    return `${contract}-${user}-${poolIndex}`;
}

function userStakeHistoriesPushHistory(contract: string, user: string, poolIndex: BigInt, beginTime: BigInt): void {
    let id = userStakeHistoriesID(contract, user, poolIndex);
    let userStakeHistories = UserStakeHistories.load(id);

    if (userStakeHistories == null) {
        let newUserStakeHistories = new UserStakeHistories(id);
        let histories = newUserStakeHistories.histories;
        histories.push(beginTime);
        newUserStakeHistories.histories = histories;
        newUserStakeHistories.save();
    } else {
        let histories = userStakeHistories.histories;
        histories.push(beginTime);
        userStakeHistories.histories = histories;
        userStakeHistories.save();
    }
    return;
}

function userStakeHistoriesRemoveStakeHistoryByContractState(contract: Address, user: Address, pid: BigInt, removeType: RemoveType): void {
    let racaContract = RACAstake.bind(contract);
    let callResult = racaContract.try_getUserStakeHisCnt(pid, user)
    if (callResult.reverted) {
        return;
    }
    let userStakesCount = callResult.value;
    let userStakesHistories = UserStakeHistories.load(userStakeHistoriesID(contract.toHex(), user.toHex(), pid));

    if (userStakesHistories == null) {
        log.info("[matrix] userStakesHistories must be non-null", []);
    } else {
        if (userStakesHistories.histories.length == 0 || userStakesCount.toI32() >= userStakesHistories.histories.length) {
            log.info!("[matrix] fuck fuck fuck!, histories length: {}, userStakesCount: {},", [userStakesHistories.histories.length.toString(), userStakesCount.toString()]);
            return;
        }

        let diffIndex = -1;

        for (let i = 0; i < userStakesCount.toI32(); i++) {
            if (userStakesHistories.histories[i] != racaContract.user(pid, user, BigInt.fromI32(i))) {
                diffIndex = i;
                break;
            }
        }

        if (diffIndex == -1) {
            diffIndex = userStakesHistories.histories.length - 1;
        }

        let beginTime = userStakesHistories.histories[diffIndex];
        let histories = userStakesHistories.histories;
        histories[diffIndex] = histories[histories.length - 1];
        histories.pop();
        userStakesHistories.histories = histories;
        userStakesHistories.save();

        let userStakeHistory = UserStakeHistory.load(userStakeHistoryID(contract.toHex(), user.toHex(), beginTime));
        if (userStakeHistory == null) {
            log.info("[matrix] userStakeHistory must be non-null", []);
        } else {
            switch (removeType) {
                case RemoveType.ForceWithdraw:
                    userStakeHistory.forceWithdrawed = true;
                    break;
                case RemoveType.Havest:
                    userStakeHistory.harvested = true;
                    break;
            }
            userStakeHistory.save();
        }
    }
    return;
}

function stakePoolID(contract: string, index: BigInt): string {
    return `${contract}-${index}`;
}

function newStakePoolIndex(contract: string): BigInt {
    let stakePoolCount = StakePoolCount.load(contract);
    if (stakePoolCount == null) {
        let newStakePoolCount = new StakePoolCount(contract);
        newStakePoolCount.count = BigInt.fromI32(1);
        newStakePoolCount.save();
        return BigInt.fromI32(0);
    } else {
        let currentCount = stakePoolCount.count;
        stakePoolCount.count = currentCount.plus(BigInt.fromI32(1));
        stakePoolCount.save();
        return currentCount;
    }
}

export function handleRacaAddPool(event: AddPoolEvent): void {
    let index = newStakePoolIndex(event.address.toHex());
    let newStakePool = new StakePool(stakePoolID(event.address.toHex(), index));
    newStakePool.tokenAddress = event.params.tokenAddress;
    newStakePool.stakeAmount = event.params.stakeAmount;
    newStakePool.nftAddress = event.params.nftAddress;
    newStakePool.save();
}


export function handleRacaStakeEvent(event: StakeEvent): void {
    let userStakeHistory = new UserStakeHistory(userStakeHistoryID(event.address.toHex(), event.params.user.toHex(), event.params.beginTime));
    userStakeHistory.user = event.params.user;
    userStakeHistory.contract = event.address;
    userStakeHistory.type = "Stake";
    userStakeHistory.stakePool = stakePoolID(event.address.toHex(), event.params.pid);
    userStakeHistory.txhash = event.transaction.hash;
    userStakeHistory.beginTime = event.params.beginTime;
    userStakeHistory.save();
    userStakeHistoriesPushHistory(event.address.toHex(), event.params.user.toHex(), event.params.pid, event.params.beginTime);
}

export function handleRacaStakeForceWithdrawEvent(event: ForceWithdrawEvent): void {
    userStakeHistoriesRemoveStakeHistoryByContractState(event.address, event.params.user, event.params.pid, RemoveType.ForceWithdraw);
    return;
}

export function handleRacaStakeHarvestEvent(event: HarvestEvent): void {
    userStakeHistoriesRemoveStakeHistoryByContractState(event.address, event.params.user, event.params.pid, RemoveType.Havest);
    return;
}