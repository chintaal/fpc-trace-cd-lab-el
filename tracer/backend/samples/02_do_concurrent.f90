! Construct 02: DO CONCURRENT Loop
! Demonstrates: Parallel region extraction, independence guarantee,
!               omp.parallel/wsloop in FIR, auto-vectorization in LLVM IR
subroutine do_concurrent_scale(a, b, scale, n)
  implicit none
  integer, intent(in)  :: n
  real,    intent(in)  :: b(n), scale
  real,    intent(out) :: a(n)
  integer :: i

  ! DO CONCURRENT declares no loop-carried dependences
  DO CONCURRENT (i = 1:n)
    a(i) = b(i) * scale
  END DO

end subroutine do_concurrent_scale

subroutine do_concurrent_2d(c, a, b, m, n)
  implicit none
  integer, intent(in)  :: m, n
  real,    intent(in)  :: a(m,n), b(m,n)
  real,    intent(out) :: c(m,n)
  integer :: i, j

  ! Nested DO CONCURRENT — demonstrates 2D tiling opportunity
  DO CONCURRENT (i = 1:m, j = 1:n)
    c(i,j) = a(i,j) + b(i,j)
  END DO

end subroutine do_concurrent_2d
