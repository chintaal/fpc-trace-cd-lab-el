! Construct 04: FORALL Statement (F95, deprecated in F2018)
! Demonstrates: Multi-index parallel assignment, index mapping,
!               comparison with DO CONCURRENT in FIR output
subroutine forall_identity(a, n)
  implicit none
  integer, intent(in)  :: n
  real,    intent(out) :: a(n,n)
  integer :: i, j

  ! FORALL: all RHS values computed before any assignment
  FORALL (i = 1:n, j = 1:n)
    a(i,j) = MERGE(1.0, 0.0, i == j)
  END FORALL

end subroutine forall_identity

subroutine forall_shift(b, a, n)
  implicit none
  integer, intent(in)  :: n
  real,    intent(in)  :: a(n)
  real,    intent(out) :: b(n)
  integer :: i

  ! Shift with FORALL — RHS reads old a, no aliasing hazard
  FORALL (i = 2:n)
    b(i) = a(i-1) + a(i)
  END FORALL
  b(1) = a(1)

end subroutine forall_shift
