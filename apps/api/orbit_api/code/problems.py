"""Code AI's problem set: the patterns most coding rounds draw on (after the pattern-first prep the interview guides
recommend over grinding problem counts), two problems each, an easier then a harder one. Written for Orbit.

Each problem has a JavaScript signature and tests (run in the candidate's browser, in a worker: nothing runs on
the server), a Python signature to write in (reviewed by the AI, not run), three hints that go from a nudge to the
idea without ever giving code, and the complexity a strong answer reaches.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

Difficulty = Literal["easy", "medium", "hard"]


class Test(BaseModel):
    args: list[Any]
    expected: Any


class Problem(BaseModel):
    id: str
    title: str
    pattern: str
    difficulty: Difficulty
    statement: str
    examples: list[str]
    function: str  # the JavaScript function's name
    js: str  # the starting code
    python: str
    tests: list[Test]
    unordered: bool = False  # the answer is a list whose order doesn't matter
    hints: list[str]
    target: str  # the time and space a strong answer reaches


PATTERNS = ["Hashing", "Two pointers", "Sliding window", "Binary search", "Stack", "Trees and graphs (BFS/DFS)",
            "Heaps and intervals", "Dynamic programming"]


def _p(**kw: Any) -> Problem:
    kw["tests"] = [Test(args=a, expected=e) for a, e in kw["tests"]]
    return Problem(**kw)


PROBLEMS: list[Problem] = [
    _p(id="pair-sum", title="Pair that adds up", pattern="Hashing", difficulty="easy",
       statement="Given a list of whole numbers and a target, return the positions (0-based) of the two numbers that "
                 "add up to the target, smaller position first. Exactly one such pair exists, and a number can't be "
                 "paired with itself.",
       examples=["nums = [4, 9, 1, 7], target = 8 → [2, 3] (1 + 7)", "nums = [3, 3], target = 6 → [0, 1]"],
       function="pairSum", js="function pairSum(nums, target) {\n  \n}\n",
       python="def pair_sum(nums: list[int], target: int) -> list[int]:\n    ...\n",
       tests=[([[4, 9, 1, 7], 8], [2, 3]), ([[3, 3], 6], [0, 1]), ([[-2, 5, 11, 0], 9], [0, 2]),
              ([[1, 5, 9, 14, 20], 34], [3, 4])],
       hints=["Checking every pair is O(n²). What would you need to remember to check each number only once?",
              "For each number x, the partner you need is target - x. Have you already seen it?",
              "Keep a map from value to its position as you go; look up target - x before adding x."],
       target="O(n) time, O(n) space"),
    _p(id="group-anagrams", title="Group words by letters", pattern="Hashing", difficulty="medium",
       statement="Given a list of lowercase words, group together the words that are made of exactly the same "
                 "letters (the same counts of each). Return the groups; each group's words in the order they "
                 "appeared, the groups in the order their first word appeared.",
       examples=['["tea", "ate", "tan", "eat", "nat", "bat"] → [["tea", "ate", "eat"], ["tan", "nat"], ["bat"]]'],
       function="groupWords", js="function groupWords(words) {\n  \n}\n",
       python="def group_words(words: list[str]) -> list[list[str]]:\n    ...\n",
       tests=[([["tea", "ate", "tan", "eat", "nat", "bat"]], [["tea", "ate", "eat"], ["tan", "nat"], ["bat"]]),
              ([["a"]], [["a"]]), ([["ab", "ba", "abc", "cab", "bca", "x"]], [["ab", "ba"], ["abc", "cab", "bca"],
                                                                                   ["x"]])],
       hints=["Two words belong together when something about them is identical. What could you compute from a "
              "word that's the same for all its rearrangements?",
              "Sorting a word's letters gives the same string for every rearrangement.",
              "Use that sorted string (or a 26-count) as a map key; a map keeps insertion order for the groups."],
       target="O(n · k log k) time for n words of length k, O(n · k) space"),
    _p(id="palindrome", title="Is it a palindrome, ignoring the rest?", pattern="Two pointers",
       difficulty="easy",
       statement="Return true if a string reads the same forwards and backwards when you keep only letters and digits "
                 "and ignore upper/lower case.",
       examples=['"Never odd or even" → true', '"Orbit, tibro!" → true', '"abc" → false'],
       function="isPalindrome", js="function isPalindrome(s) {\n  \n}\n",
       python="def is_palindrome(s: str) -> bool:\n    ...\n",
       tests=[(["Never odd or even"], True), (["Orbit, tibro!"], True), (["abc"], False), ([""], True),
              (["0P"], False)],
       hints=["You can compare from both ends at once.",
              "Move a left and a right index towards each other, skipping anything that isn't a letter or digit.",
              "Compare lowercased characters; stop as soon as two differ."],
       target="O(n) time, O(1) space"),
    _p(id="container", title="Biggest tank between walls", pattern="Two pointers", difficulty="medium",
       statement="heights[i] is the height of a wall at position i. Pick two walls; the water they hold is the "
                 "distance between them times the shorter wall. Return the most water any two walls can hold.",
       examples=["[1, 8, 6, 2, 5, 4, 8, 3, 7] → 49 (walls at 1 and 8: distance 7 × height 7)"],
       function="biggestTank", js="function biggestTank(heights) {\n  \n}\n",
       python="def biggest_tank(heights: list[int]) -> int:\n    ...\n",
       tests=[([[1, 8, 6, 2, 5, 4, 8, 3, 7]], 49), ([[1, 1]], 1), ([[4, 3, 2, 1, 4]], 16), ([[1, 2, 1]], 2)],
       hints=["Start with the widest pair: the two ends. Which wall is limiting the water?",
              "Moving the taller wall inward can only make it worse. Why?",
              "Keep two pointers; always move the shorter wall inward, and track the best area."],
       target="O(n) time, O(1) space"),
    _p(id="max-window-sum", title="Best run of k days", pattern="Sliding window", difficulty="easy",
       statement="Given daily sales and a number k, return the largest total of any k consecutive days.",
       examples=["sales = [2, 1, 5, 1, 3, 2], k = 3 → 9 (5 + 1 + 3)"],
       function="bestRun", js="function bestRun(sales, k) {\n  \n}\n",
       python="def best_run(sales: list[int], k: int) -> int:\n    ...\n",
       tests=[([[2, 1, 5, 1, 3, 2], 3], 9), ([[5], 1], 5), ([[-1, -2, -3], 2], -3), ([[1, 2, 3, 4], 4], 10)],
       hints=["Recomputing each window's sum from scratch repeats work.",
              "When the window moves one day, only one day leaves and one day joins.",
              "Keep a running sum: add the new day, subtract the day that left, track the max."],
       target="O(n) time, O(1) space"),
    _p(id="longest-unique", title="Longest stretch with no repeats", pattern="Sliding window",
       difficulty="medium",
       statement="Return the length of the longest stretch of a string in which no character appears twice.",
       examples=['"abcabcbb" → 3 ("abc")', '"pwwkew" → 3 ("wke")'],
       function="longestUnique", js="function longestUnique(s) {\n  \n}\n",
       python="def longest_unique(s: str) -> int:\n    ...\n",
       tests=[(["abcabcbb"], 3), (["bbbbb"], 1), (["pwwkew"], 3), ([""], 0), (["dvdf"], 3), (["abba"], 2)],
       hints=["Grow a window to the right while it has no repeats. What do you do when it gets one?",
              "When a repeat comes in, move the window's left edge past the earlier copy of that character.",
              "Remember each character's last position; left = max(left, last[c] + 1)."],
       target="O(n) time, O(alphabet) space"),
    _p(id="first-at-least", title="First version at or above", pattern="Binary search", difficulty="easy",
       statement="Given a sorted list of numbers and a value, return the position of the first number that is at "
                 "least that value, or the list's length if there's none.",
       examples=["[1, 3, 3, 5, 8], 3 → 1", "[1, 3, 3, 5, 8], 9 → 5"],
       function="firstAtLeast", js="function firstAtLeast(nums, value) {\n  \n}\n",
       python="def first_at_least(nums: list[int], value: int) -> int:\n    ...\n",
       tests=[([[1, 3, 3, 5, 8], 3], 1), ([[1, 3, 3, 5, 8], 9], 5), ([[1, 3, 3, 5, 8], 0], 0), ([[], 4], 0),
              ([[2, 2, 2], 2], 0)],
       hints=["The list is sorted: you can rule out half of it with one comparison.",
              "Keep a range [lo, hi) where the answer must be; look at the middle.",
              "If nums[mid] < value the answer is right of mid (lo = mid + 1), else it's mid or left (hi = mid)."],
       target="O(log n) time, O(1) space"),
    _p(id="ship-capacity", title="Smallest truck that makes it in time", pattern="Binary search",
       difficulty="medium",
       statement="Parcels must go out in the given order. Each day a truck carries parcels in order until the next "
                 "one would go over its capacity. Return the smallest capacity that ships everything within the "
                 "given number of days.",
       examples=["weights = [1,2,3,4,5,6,7,8,9,10], days = 5 → 15"],
       function="smallestTruck", js="function smallestTruck(weights, days) {\n  \n}\n",
       python="def smallest_truck(weights: list[int], days: int) -> int:\n    ...\n",
       tests=[([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5], 15), ([[3, 2, 2, 4, 1, 4], 3], 6), ([[1, 2, 3, 1, 1], 4], 3),
              ([[10], 1], 10)],
       hints=["If a capacity works, does every bigger capacity work too?",
              "So you can binary search on the capacity itself, between the heaviest parcel and the total weight.",
              "For a candidate capacity, count days greedily; if it fits in the days, try smaller."],
       target="O(n log(sum)) time, O(1) space"),
    _p(id="balanced-brackets", title="Brackets that close properly", pattern="Stack", difficulty="easy",
       statement="A string has only the characters ()[]{}. Return true if every bracket is closed by the same kind, "
                 "in the right order.",
       examples=['"([]{})" → true', '"(]" → false', '"([)]" → false'],
       function="balanced", js="function balanced(s) {\n  \n}\n",
       python="def balanced(s: str) -> bool:\n    ...\n",
       tests=[(["([]{})"], True), (["(]"], False), (["([)]"], False), ([""], True), (["(("], False),
              (["{[]}()"], True)],
       hints=["The bracket that must close next is the most recently opened one.",
              "Push opening brackets; on a closing one, the top must be its partner.",
              "At the end the stack must be empty."],
       target="O(n) time, O(n) space"),
    _p(id="next-warmer", title="Days until a warmer day", pattern="Stack", difficulty="medium",
       statement="Given daily temperatures, return for each day how many days you wait for a warmer one (0 if none "
                 "comes).",
       examples=["[73, 74, 75, 71, 69, 72, 76, 73] → [1, 1, 4, 2, 1, 1, 0, 0]"],
       function="daysUntilWarmer", js="function daysUntilWarmer(temps) {\n  \n}\n",
       python="def days_until_warmer(temps: list[int]) -> list[int]:\n    ...\n",
       tests=[([[73, 74, 75, 71, 69, 72, 76, 73]], [1, 1, 4, 2, 1, 1, 0, 0]), ([[30, 40, 50, 60]], [1, 1, 1, 0]),
              ([[30, 20, 10]], [0, 0, 0])],
       hints=["Looking ahead from every day is O(n²). Which days are still waiting for an answer?",
              "The days still waiting always have falling temperatures. A stack can hold them.",
              "For each day, pop every waiting day that's colder and answer it; then push today."],
       target="O(n) time, O(n) space"),
    _p(id="tree-depth", title="How deep is the tree?", pattern="Trees and graphs (BFS/DFS)", difficulty="easy",
       statement="A tree is given as nested objects {value, left, right} (left and right may be null). Return the "
                 "number of nodes on the longest path from the root down to a leaf (0 for an empty tree).",
       examples=["{value: 3, left: {value: 9}, right: {value: 20, left: {value: 15}, right: {value: 7}}} → 3"],
       function="depth", js="function depth(root) {\n  \n}\n",
       python="def depth(root: dict | None) -> int:\n    ...\n",
       tests=[([{"value": 3, "left": {"value": 9, "left": None, "right": None},
                 "right": {"value": 20, "left": {"value": 15, "left": None, "right": None},
                           "right": {"value": 7, "left": None, "right": None}}}], 3),
              ([None], 0), ([{"value": 1, "left": None, "right": {"value": 2, "left": None, "right": None}}], 2)],
       hints=["The depth of a tree depends on the depths of its two subtrees.",
              "depth(node) = 1 + the larger of depth(left) and depth(right).",
              "The empty tree has depth 0: that's where the recursion stops."],
       target="O(n) time, O(height) space"),
    _p(id="islands", title="Count the islands", pattern="Trees and graphs (BFS/DFS)", difficulty="medium",
       statement="A grid of '1' (land) and '0' (water). Land cells joined up, down, left or right form one island. "
                 "Return how many islands there are.",
       examples=['[["1","1","0"],["0","1","0"],["0","0","1"]] → 2'],
       function="countIslands", js="function countIslands(grid) {\n  \n}\n",
       python="def count_islands(grid: list[list[str]]) -> int:\n    ...\n",
       tests=[([[["1", "1", "0"], ["0", "1", "0"], ["0", "0", "1"]]], 2), ([[["0"]]], 0),
              ([[["1", "0", "1"], ["0", "1", "0"], ["1", "0", "1"]]], 5),
              ([[["1", "1", "1"], ["1", "0", "1"], ["1", "1", "1"]]], 1)],
       hints=["Each time you find land you haven't visited, that's a new island.",
              "From there, visit all the land connected to it so you don't count it again.",
              "Loop over cells; on unvisited land, count one and flood-fill it (DFS or BFS) marking it visited."],
       target="O(rows × cols) time and space"),
    _p(id="k-largest", title="The k-th largest score", pattern="Heaps and intervals", difficulty="medium",
       statement="Return the k-th largest number in a list (k = 1 is the largest). Duplicates count separately.",
       examples=["[3, 2, 1, 5, 6, 4], k = 2 → 5", "[3, 2, 3, 1, 2, 4, 5, 5, 6], k = 4 → 4"],
       function="kthLargest", js="function kthLargest(nums, k) {\n  \n}\n",
       python="def kth_largest(nums: list[int], k: int) -> int:\n    ...\n",
       tests=[([[3, 2, 1, 5, 6, 4], 2], 5), ([[3, 2, 3, 1, 2, 4, 5, 5, 6], 4], 4), ([[1], 1], 1),
              ([[7, 7, 7], 2], 7)],
       hints=["Sorting works in O(n log n). Can you keep only what you need?",
              "You only ever need the k largest seen so far.",
              "Keep a min-heap of size k; its top is the answer. (In an interview, say how you'd build the heap.)"],
       target="O(n log k) time, O(k) space"),
    _p(id="merge-meetings", title="Merge overlapping meetings", pattern="Heaps and intervals", difficulty="medium",
       statement="Given meetings as [start, end] pairs, merge every set that overlaps or touches and return the "
                 "merged meetings sorted by start.",
       examples=["[[1,3],[2,6],[8,10],[15,18]] → [[1,6],[8,10],[15,18]]", "[[1,4],[4,5]] → [[1,5]]"],
       function="mergeMeetings", js="function mergeMeetings(meetings) {\n  \n}\n",
       python="def merge_meetings(meetings: list[list[int]]) -> list[list[int]]:\n    ...\n",
       tests=[([[[1, 3], [2, 6], [8, 10], [15, 18]]], [[1, 6], [8, 10], [15, 18]]), ([[[1, 4], [4, 5]]], [[1, 5]]),
              ([[[5, 7], [1, 2]]], [[1, 2], [5, 7]]), ([[[1, 10], [2, 3], [4, 5]]], [[1, 10]])],
       hints=["Meetings are easier to merge when they're in order.",
              "Sort by start; then each meeting either extends the last merged one or starts a new one.",
              "Overlap when start <= last end; then last end = max(last end, end)."],
       target="O(n log n) time, O(n) space"),
    _p(id="climb-stairs", title="Ways up the stairs", pattern="Dynamic programming", difficulty="easy",
       statement="You climb a staircase of n steps, taking 1 or 2 steps at a time. Return how many different ways "
                 "there are to reach the top.",
       examples=["n = 2 → 2 (1+1, 2)", "n = 3 → 3 (1+1+1, 1+2, 2+1)"],
       function="waysUp", js="function waysUp(n) {\n  \n}\n",
       python="def ways_up(n: int) -> int:\n    ...\n",
       tests=[([1], 1), ([2], 2), ([3], 3), ([5], 8), ([30], 1346269)],
       hints=["How could you have arrived at step n?",
              "From step n-1 or from step n-2: ways(n) = ways(n-1) + ways(n-2).",
              "Build it up from the bottom keeping only the last two values."],
       target="O(n) time, O(1) space"),
    _p(id="coin-change", title="Fewest coins for an amount", pattern="Dynamic programming", difficulty="medium",
       statement="Given coin values (as many of each as you like) and an amount, return the fewest coins that add up "
                 "to the amount, or -1 if it can't be made.",
       examples=["coins = [1, 2, 5], amount = 11 → 3 (5 + 5 + 1)", "coins = [2], amount = 3 → -1"],
       function="fewestCoins", js="function fewestCoins(coins, amount) {\n  \n}\n",
       python="def fewest_coins(coins: list[int], amount: int) -> int:\n    ...\n",
       tests=[([[1, 2, 5], 11], 3), ([[2], 3], -1), ([[1], 0], 0), ([[2, 5, 10, 1], 27], 4), ([[186, 419, 83, 408],
                                                                                              6249], 20)],
       hints=["Always taking the biggest coin fails for some coin sets. Can you try every last coin?",
              "best(a) = 1 + the smallest best(a - c) over coins c that fit.",
              "Fill a table from 0 up to the amount; unreachable amounts stay at infinity."],
       target="O(amount × coins) time, O(amount) space"),
]

BY_ID = {p.id: p for p in PROBLEMS}
