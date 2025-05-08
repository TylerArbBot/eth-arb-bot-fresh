// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IRouter {
    function getAmountsOut(
        uint amountIn,
        address[] memory path
    ) external view returns (uint[] memory amounts);

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract MemoryArbBot is Ownable {
    IRouter public router1;
    IRouter public router2;
    IERC20 public token0;
    IERC20 public token1;

    event ArbExecuted(uint profit, uint timestamp);

    constructor(
        address _router1,
        address _router2,
        address _token0,
        address _token1
    ) Ownable(msg.sender) {
        router1 = IRouter(_router1);
        router2 = IRouter(_router2);
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
    }

    /// @notice Simulate the two-leg swap without sending a tx
    function simulateArb(uint amount0) public view returns (uint profit) {
        address[] memory path = new address[](2);
        path[0] = address(token0);
        path[1] = address(token1);
        uint[] memory out1 = router1.getAmountsOut(amount0, path);
        uint[] memory out2 = router2.getAmountsOut(out1[1], _reversePath(path));
        return out2[1] > amount0 ? out2[1] - amount0 : 0;
    }

    /**
     * @param amount0 how much token0 to start with
     * @param minProfit the minimum acceptable profit in token0
     */
    function executeArb(uint amount0, uint minProfit) external onlyOwner {
        // 1. Approve token0 to router1
        token0.approve(address(router1), amount0);

        // 2. Get output estimate from router1
        address[] memory path = new address[](2);
        path[0] = address(token0);
        path[1] = address(token1);
        uint[] memory out1 = router1.getAmountsOut(amount0, path);

        // 3. Approve token1 to router2
        token1.approve(address(router2), out1[1]);

        // 4. Perform swap back on router2
        uint[] memory out2 = router2.swapExactTokensForTokens(
            out1[1],
            1, // accept any non-zero amount
            _reversePath(path),
            address(this),
            block.timestamp + 300
        );

        // 5. Calculate profit
        uint profit = out2[1] > amount0 ? out2[1] - amount0 : 0;

        require(profit >= minProfit, "Profit below threshold");
        emit ArbExecuted(profit, block.timestamp);
    }

    function _reversePath(address[] memory path) internal pure returns (address[] memory) {
        address[] memory rev = new address[](2);
        rev[0] = path[1];
        rev[1] = path[0];
        return rev;
    }

    function withdrawTokens(address _token) external onlyOwner {
        IERC20(_token).transfer(owner(), IERC20(_token).balanceOf(address(this)));
    }
}
