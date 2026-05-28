! Construct 01: Array Element-wise Assignment
! Demonstrates: HLFIR elemental model, fir.array_load/fetch/update
subroutine array_add(a, b, c, n)
  implicit none
  integer, intent(in)  :: n
  real,    intent(in)  :: b(n), c(n)
  real,    intent(out) :: a(n)

  ! This single line triggers the full elemental lowering chain
  a = b + c

end subroutine array_add

! Scalar variant for comparison
subroutine scalar_add(x, y, z)
  implicit none
  real, intent(in)  :: y, z
  real, intent(out) :: x
  x = y + z
end subroutine scalar_add
