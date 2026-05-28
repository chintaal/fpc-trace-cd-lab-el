! Construct 09: Recursive Function
! Demonstrates: Stack frame allocation, alloca patterns in LLVM IR,
!               absence of TCO in Flang, call graph structure in FIR
module recursion_demo
  implicit none

contains

  ! Classic recursive factorial — stack-allocating each frame
  recursive function factorial(n) result(r)
    integer, intent(in) :: n
    integer(kind=8)     :: r
    if (n <= 1) then
      r = 1
    else
      r = n * factorial(n - 1)
    end if
  end function factorial

  ! Fibonacci — dual recursive call, expensive call graph in LLVM IR
  recursive function fib(n) result(f)
    integer, intent(in) :: n
    integer :: f
    if (n <= 1) then
      f = n
    else
      f = fib(n - 1) + fib(n - 2)
    end if
  end function fib

  ! Mutual recursion — even/odd test
  recursive function is_even(n) result(b)
    integer, intent(in) :: n
    logical :: b
    if (n == 0) then
      b = .TRUE.
    else
      b = is_odd(n - 1)
    end if
  end function is_even

  recursive function is_odd(n) result(b)
    integer, intent(in) :: n
    logical :: b
    if (n == 0) then
      b = .FALSE.
    else
      b = is_even(n - 1)
    end if
  end function is_odd

end module recursion_demo
