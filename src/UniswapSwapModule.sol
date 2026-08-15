// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.22;

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);

    function swapTokensForExactETH(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapETHForExactTokens(uint256 amountOut, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);

    function getAmountsIn(uint256 amountOut, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);
}

/**
 * @title UniswapSwapModule
 * @dev Modular contract for handling Uniswap V2 swaps
 * @notice This contract is designed to be called by a MultiSig contract
 */
contract UniswapSwapModule {
    event SwapExecuted(
        address indexed caller, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut
    );

    event ETHSwapExecuted(
        address indexed caller, bool isETHIn, address indexed token, uint256 ethAmount, uint256 tokenAmount
    );

    /**
     * @dev Swap exact tokens for tokens
     * @param routerAddress Uniswap V2 Router address
     * @param amountIn Amount of input tokens
     * @param amountOutMin Minimum amount of output tokens
     * @param path Array of token addresses for swap path
     * @param deadline Unix timestamp deadline
     * @return amounts Array of amounts for each step in the path
     */
    function swapExactTokensForTokens(
        address routerAddress,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(path.length >= 2, "Invalid path");
        require(deadline >= block.timestamp, "Deadline expired");

        // Transfer tokens from caller to this contract
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        // Approve router to spend tokens
        IERC20(path[0]).approve(routerAddress, amountIn);

        // Execute swap
        amounts = IUniswapV2Router02(routerAddress).swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            msg.sender, // Send output tokens back to caller
            deadline
        );

        emit SwapExecuted(msg.sender, path[0], path[path.length - 1], amountIn, amounts[amounts.length - 1]);

        return amounts;
    }

    /**
     * @dev Swap exact ETH for tokens
     * @param routerAddress Uniswap V2 Router address
     * @param amountOutMin Minimum amount of output tokens
     * @param path Array of token addresses (must start with WETH)
     * @param deadline Unix timestamp deadline
     * @return amounts Array of amounts for each step in the path
     */
    function swapExactETHForTokens(
        address routerAddress,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts) {
        require(path.length >= 2, "Invalid path");
        require(deadline >= block.timestamp, "Deadline expired");
        require(msg.value > 0, "No ETH sent");

        // Execute swap
        amounts = IUniswapV2Router02(routerAddress).swapExactETHForTokens{value: msg.value}(
            amountOutMin,
            path,
            msg.sender, // Send output tokens back to caller
            deadline
        );

        emit ETHSwapExecuted(msg.sender, true, path[path.length - 1], msg.value, amounts[amounts.length - 1]);

        return amounts;
    }

    /**
     * @dev Swap exact tokens for ETH
     * @param routerAddress Uniswap V2 Router address
     * @param amountIn Amount of input tokens
     * @param amountOutMin Minimum amount of ETH out
     * @param path Array of token addresses (must end with WETH)
     * @param deadline Unix timestamp deadline
     * @return amounts Array of amounts for each step in the path
     */
    function swapExactTokensForETH(
        address routerAddress,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(path.length >= 2, "Invalid path");
        require(deadline >= block.timestamp, "Deadline expired");

        // Transfer tokens from caller to this contract
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        // Approve router to spend tokens
        IERC20(path[0]).approve(routerAddress, amountIn);

        // Execute swap
        amounts = IUniswapV2Router02(routerAddress).swapExactTokensForETH(
            amountIn,
            amountOutMin,
            path,
            msg.sender, // Send ETH back to caller
            deadline
        );

        emit ETHSwapExecuted(msg.sender, false, path[0], amounts[amounts.length - 1], amountIn);

        return amounts;
    }

    /**
     * @dev Swap tokens for exact tokens
     * @param routerAddress Uniswap V2 Router address
     * @param amountOut Exact amount of output tokens desired
     * @param amountInMax Maximum amount of input tokens
     * @param path Array of token addresses for swap path
     * @param deadline Unix timestamp deadline
     * @return amounts Array of amounts for each step in the path
     */
    function swapTokensForExactTokens(
        address routerAddress,
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(path.length >= 2, "Invalid path");
        require(deadline >= block.timestamp, "Deadline expired");

        // Transfer max tokens from caller to this contract
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountInMax);

        // Approve router to spend tokens
        IERC20(path[0]).approve(routerAddress, amountInMax);

        // Execute swap
        amounts = IUniswapV2Router02(routerAddress).swapTokensForExactTokens(
            amountOut,
            amountInMax,
            path,
            msg.sender, // Send output tokens back to caller
            deadline
        );

        // Refund unused input tokens
        uint256 amountUsed = amounts[0];
        if (amountInMax > amountUsed) {
            IERC20(path[0]).transfer(msg.sender, amountInMax - amountUsed);
        }

        emit SwapExecuted(msg.sender, path[0], path[path.length - 1], amounts[0], amountOut);

        return amounts;
    }

    /**
     * @dev Get expected output amounts for a swap
     * @param routerAddress Uniswap V2 Router address
     * @param amountIn Amount of input tokens
     * @param path Array of token addresses for swap path
     * @return amounts Expected amounts for each step in the path
     */
    function getAmountsOut(address routerAddress, uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        return IUniswapV2Router02(routerAddress).getAmountsOut(amountIn, path);
    }

    /**
     * @dev Get required input amounts for a desired output
     * @param routerAddress Uniswap V2 Router address
     * @param amountOut Desired amount of output tokens
     * @param path Array of token addresses for swap path
     * @return amounts Required amounts for each step in the path
     */
    function getAmountsIn(address routerAddress, uint256 amountOut, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        return IUniswapV2Router02(routerAddress).getAmountsIn(amountOut, path);
    }

    /**
     * @dev Allows contract to receive ETH
     */
    receive() external payable {}
}
