! Construct 08: Array Intrinsics — MATMUL, TRANSPOSE, SUM
! Demonstrates: Intrinsic lowering to runtime library calls vs inline,
!               temporary result arrays (hlfir.expr), _FortranAMatmul ABI
subroutine matrix_ops(c, a, b, n, m, k)
  implicit none
  integer, intent(in)  :: n, m, k
  real,    intent(in)  :: a(n,m), b(m,k)
  real,    intent(out) :: c(n,k)

  ! MATMUL → runtime call _FortranAMatmul (or BLAS sgemm if available)
  c = MATMUL(a, b)

end subroutine matrix_ops

subroutine reduction_demo(result_sum, result_max, a, n)
  implicit none
  integer, intent(in)  :: n
  real,    intent(in)  :: a(n)
  real,    intent(out) :: result_sum, result_max

  ! SUM → _FortranASum or inline loop (dimension-1 case may inline)
  result_sum = SUM(a)

  ! MAXVAL → _FortranAMaxvalReal or inline
  result_max = MAXVAL(a)

end subroutine reduction_demo

subroutine transpose_demo(b, a, n, m)
  implicit none
  integer, intent(in)  :: n, m
  real,    intent(in)  :: a(n,m)
  real,    intent(out) :: b(m,n)

  ! TRANSPOSE → hlfir.elemental with swapped indices
  ! No runtime call — lowered as an element-wise operation
  b = TRANSPOSE(a)

end subroutine transpose_demo
