# Mixed practice

The queue size is the smaller of the requested size and the available library; All uses the entire library. Allocate 40% difficult, 30% recent, and 30% random using largest remainders: floor each quota, then assign leftover cards by descending fractional remainder, breaking ties in difficult/recent/random order. Sizes 10, 25, and 50 yield 4/3/3, 10/8/7, and 20/15/15. One card yields 1/0/0; two yield 1/1/0.

Historical pools use the selected learner profile and learning direction. Recent includes accepted reviews from the preceding seven days, including the cutoff and excluding future timestamps. Select difficult entries first, then recent entries excluding selected difficult entries. Random entries and any shortage backfill come from all remaining library entries. Shuffle the final unique queue and persist its order and wording through the existing session API. No schema migration is required.
