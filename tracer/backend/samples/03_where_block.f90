! Construct 03: WHERE Block (Masked Array Assignment)
! Demonstrates: Masked elemental operations, conditional array assignment,
!               fir.if within hlfir.elemental body
subroutine safe_sqrt(result, input, n)
  implicit none
  integer, intent(in)  :: n
  real,    intent(in)  :: input(n)
  real,    intent(out) :: result(n)

  ! WHERE generates a boolean mask and applies it element-wise
  WHERE (input > 0.0)
    result = SQRT(input)
  ELSEWHERE
    result = 0.0
  END WHERE

end subroutine safe_sqrt

subroutine clip_array(a, lo, hi, n)
  implicit none
  integer, intent(in)    :: n
  real,    intent(in)    :: lo, hi
  real,    intent(inout) :: a(n)

  WHERE (a < lo) a = lo
  WHERE (a > hi) a = hi

end subroutine clip_array
